import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// Lazy, not module-scope: Next.js bundles every server action in a page
// together, so an eager `new Anthropic(...)` here would throw at import
// time for actions that never touch chat (e.g. saving project notes) if
// ANTHROPIC_API_KEY isn't set.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.anthropicApiKey() });
  }
  return client;
}

export type MondayListItem = {
  name: string;
  estimateHours: number | null;
  priority: string | null;
  dueOn: string | null;
};

export type ChatAction =
  | { type: "monday_list"; items: MondayListItem[] }
  | { type: "idea"; items: { title: string }[] }
  | { type: "priority_override"; taskName: string; newPriority: string }
  | { type: "plan_change"; taskName: string; newDay: string | null; newDurationHours: number | null; durationDeltaHours: number | null }
  | { type: "distribute_block"; taskName: string; distribution: { day: string; hours: number | null }[] }
  | { type: "must_change"; taskName: string; must: boolean }
  | { type: "remove_block"; taskName: string }
  | { type: "park_change"; taskName: string; parked: boolean }
  | { type: "set_estimate"; taskName: string; hours: number }
  | { type: "split_block"; taskName: string; hoursNow: number; remainder: "next-working-day" | "queue" }
  | { type: "reprioritise_day"; day: string | null }
  | { type: "day_lock"; day: string; locked: boolean; reason: string | null }
  | { type: "add_rule"; text: string }
  | { type: "history_query"; taskName: string | null; period: "month" | "quarter" | "all" };

/**
 * `text` is the model's own natural-language reply — present whenever it
 * said anything (which Claude can do alongside a tool call, not just
 * instead of one), shown to the user verbatim rather than a canned
 * template. `action` is set only when the model actually called a tool;
 * null means it was purely conversational this turn (discussing, asking a
 * clarifying question, flagging a conflict) — nothing to confirm or write.
 */
export type ChatResponse = { text: string | null; action: ChatAction | null };

export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

const TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_personal_tasks",
    description:
      "Use when the user's message is a Monday list: one or more non-Asana personal tasks to add. Split it into one item per task, pulling out any estimate, priority, or deadline mentioned inline. Never decide which existing task a line matches — that is done separately in code.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "The task, in the user's own words, without the estimate/priority/deadline phrases." },
              estimateHours: { type: ["number", "null"], description: "Hours mentioned for this task, or null if none was given." },
              priority: { type: ["string", "null"], description: "Priority mentioned for this task (e.g. 'high'), or null." },
              dueOn: { type: ["string", "null"], description: "Deadline mentioned, resolved to YYYY-MM-DD using today's date, or null." },
            },
            required: ["name", "estimateHours", "priority", "dueOn"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_ideas",
    description:
      "Use when the user's message describes one or more ideas to capture for later — not actionable tasks for this week. Lines starting with 'Idea:' or otherwise clearly idea-shaped (a concept, not a task with a deadline).",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_priority_override",
    description:
      "Use when the user wants to change how an existing task is prioritized without touching Asana — e.g. 'The Brian edit matters less than its date suggests' or 'bump the Arran edit to high priority'. Never decide which existing task this refers to — that is done separately in code.",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        newPriority: { type: "string", description: "The new priority level, e.g. 'High', 'Medium', or 'Low'." },
      },
      required: ["taskName", "newPriority"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_plan_change",
    description:
      "Use when the user wants to move and/or resize an already-placed task — e.g. 'Move the Arran edit to Thursday' or 'Give the Brian edit another hour'. Never decide which existing task this refers to — that is done separately in code.",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        newDay: {
          type: ["string", "null"],
          description: "The day to move it to, resolved to YYYY-MM-DD using today's date, or null if not mentioned (keep its current day).",
        },
        newDurationHours: {
          type: ["number", "null"],
          description:
            "The new total duration in hours, ONLY when the user gave an absolute figure (e.g. 'make it 3 hours'). Null otherwise — never work out a new total yourself (you don't know its current duration; code does). For a relative change ('another hour', 'half an hour less'), use durationDeltaHours instead and leave this null.",
        },
        durationDeltaHours: {
          type: ["number", "null"],
          description:
            "The hours to ADD (positive) or REMOVE (negative) from its current duration, when the user asked for a relative change — e.g. 'another hour' is 1, 'half an hour less' is -0.5. Null if the user gave an absolute total (use newDurationHours) or didn't mention duration at all.",
        },
      },
      required: ["taskName", "newDay", "newDurationHours", "durationDeltaHours"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_distribute_block",
    description:
      "Use when the user wants to split an already-placed (or currently unplaced) task's hours across TWO OR MORE specific days — e.g. 'Move the Scott Dunn edit to the weekend, 6 hours Saturday and 8 hours Sunday' (explicit hours each) or 'I only want Scott Dunn images this weekend' (naming the days, splitting evenly — leave hours null for each and code divides the task's current total evenly across them, since that's a real division, not a guess). Only leave hours null when an EVEN split across every named day is really what's meant; if the user implies an uneven split without giving numbers ('mostly Saturday'), ASK for the actual numbers instead of calling this. For a move to just one day, use propose_plan_change instead. Never decide which existing task this refers to, and never work out the hours total yourself — both are done separately in code.",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        distribution: {
          type: "array",
          description:
            "Each day to place it on, in the order the user gave them. At least two entries. Give hours explicitly when the user did; leave hours null on every entry meant to share an even split of the task's current total.",
          items: {
            type: "object",
            properties: {
              day: { type: "string", description: "YYYY-MM-DD, resolved using today's date." },
              hours: { type: ["number", "null"], description: "Hours to place on this day, or null to let code split the remaining total evenly across every null entry." },
            },
            required: ["day", "hours"],
            additionalProperties: false,
          },
        },
      },
      required: ["taskName", "distribution"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/**
 * v4 Stage 2, brief 5.3: "Chat can edit the draft" — these four are only
 * offered when the docked week-chat calls in (see `includeEditTools`), not
 * the floating popup used on every other screen, since they only make
 * sense against a specific week's draft.
 */
const EDIT_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_must_change",
    description: "Use when the user wants to mark a task Must, or clear its Must flag — e.g. 'Make the Arran edit a Must' or 'The Brian edit isn't a Must anymore'.",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        must: { type: "boolean", description: "true to flag it Must, false to clear the flag." },
      },
      required: ["taskName", "must"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_remove_block",
    description: "Use when the user wants to remove a placed task from the calendar entirely (it goes back to unplaced) — e.g. 'Take the Arran edit off the calendar'.",
    input_schema: {
      type: "object",
      properties: { taskName: { type: "string", description: "The task being referred to, in the user's own words." } },
      required: ["taskName"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_park_change",
    description: "Use when the user wants to park a task (hide it from planning without touching Asana) or unpark it — e.g. 'Park the Scotland idea' or 'Unpark the Brian edit'.",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        parked: { type: "boolean", description: "true to park it, false to unpark it." },
      },
      required: ["taskName", "parked"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_set_estimate",
    description: "Use when the user is giving or correcting a task's time estimate directly — e.g. 'The Arran edit is 3 hours'. Not for adding a brand-new personal task (use propose_personal_tasks for that).",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        hours: { type: "number", description: "The estimate in hours." },
      },
      required: ["taskName", "hours"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_split_block",
    description:
      "Use when the user wants to split an already-placed task into two parts — e.g. 'I've done 2 hours of the Brian edit, split the rest off' or 'split the Arran edit, 1 hour now and the rest in the queue'. Never decide which existing task this refers to — that is done separately in code.",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        hoursNow: { type: "number", description: "Hours to keep in the current slot; the rest becomes the second part." },
        remainder: {
          type: "string",
          enum: ["next-working-day", "queue"],
          description:
            "Where the rest goes. 'queue' when the user says the unscheduled queue/leave it unscheduled/don't reschedule it yet; otherwise default to 'next-working-day'.",
        },
      },
      required: ["taskName", "hoursNow", "remainder"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_reprioritise_day",
    description:
      "Use when the user wants to close the gap on a day by pulling what's left on that day earlier — e.g. 're-prioritise Thursday' or 'close the gap today'. This only slides existing work earlier on that day; it never re-ranks by priority or adds backlog work.",
    input_schema: {
      type: "object",
      properties: {
        day: {
          type: ["string", "null"],
          description: "The day to close the gap on, resolved to YYYY-MM-DD using today's date. Null if the user didn't name a day (defaults to today in code).",
        },
      },
      required: ["day"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_day_lock",
    description:
      "Use when the user wants to mark a day as unavailable/out of office (excluded from auto-placement), or unlock a previously locked day — e.g. 'Block out Friday, I'm off' or 'Unlock Wednesday, I'm back in'.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: "The day to lock/unlock, resolved to YYYY-MM-DD using today's date." },
        locked: { type: "boolean", description: "true to lock it (mark unavailable), false to unlock it." },
        reason: { type: ["string", "null"], description: "A short reason if the user gave one (e.g. 'Annual leave', 'Sick day'), else null." },
      },
      required: ["day", "locked", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "propose_add_rule",
    description:
      "Use when the user wants to add a standing scheduling rule by sentence — e.g. 'never schedule edits on Fridays' or 'no deep work on Mondays'. The rule's own sentence does the describing; pass it through close to verbatim, don't paraphrase or summarize it.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The rule, in the user's own words." } },
      required: ["text"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "ask_history",
    description:
      "Use when the user asks a factual question about past hours or activity — e.g. 'how many hours have I spent on the Tartan edit?' or 'what did I get done this month?'. Never answer this from the context block or from memory — this tool triggers a real, code-computed query. Never decide which existing task a name refers to — that is done separately in code.",
    input_schema: {
      type: "object",
      properties: {
        taskName: {
          type: ["string", "null"],
          description: "The task/deliverable named, in the user's own words, or null if the question isn't about one specific task (e.g. 'what did I get done this month?').",
        },
        period: {
          type: "string",
          enum: ["month", "quarter", "all"],
          description: "The window asked about — 'this month'/'this quarter'/'all time'. Pick the closest of these three for anything else asked (e.g. 'this year' → quarter is too narrow, use all) rather than inventing a new window.",
        },
      },
      required: ["taskName", "period"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const SYSTEM_PROMPT = `You are the chat assistant inside a personal weekly-planning app (brief section 9), docked on
the Week screen so it can edit the draft plan directly (v4 Stage 2, brief section 5.3). This is a real,
ongoing conversation — you see the prior turns, not just the latest message, so remember what's already
been said and build on it rather than treating every message in isolation.

Respond in plain text, with no tool call, whenever you're discussing, clarifying, thinking through
options out loud, or flagging a concern — that is the normal way to talk, not a fallback. Call a tool
only once you're actually ready to create or change something:

- A pasted or typed list of non-Asana tasks ("Monday list") → propose_personal_tasks.
- Something idea-shaped, not an actionable task for this week → propose_ideas.
- A request to change how important an existing task is → propose_priority_override.
- A request to move and/or resize an existing placed task → propose_plan_change.
- A request to split a task's hours across two or more specific days, whether hours are given
  explicitly or an even split across the named days is clearly what's meant → propose_distribute_block
  (null hours for an even split — code divides the total, never guess the number yourself). Only ask
  for the split when it's neither explicit nor evenly implied.
- A request to flag or clear a task's Must status → propose_must_change.
- A request to take a placed task off the calendar → propose_remove_block.
- A request to park or unpark a task → propose_park_change.
- The user giving or correcting a task's time estimate directly → propose_set_estimate.
- A request to split an already-placed task into two parts (how much is done so far, the rest
  elsewhere) → propose_split_block.
- A request to close the gap on a day by pulling what's left on it earlier → propose_reprioritise_day.
- A request to lock a day as out of office/unavailable, or unlock one → propose_day_lock.
- A request to add a standing scheduling rule by sentence → propose_add_rule.
- A factual question about past hours or activity (not the current/next week, which the context block already answers) → ask_history.

A question about the user's week, tasks, or capacity (including "what's at risk?", "what's on Thursday?",
"is anything sitting over lunch?", or "anything to follow up on?") is answered directly in plain text,
using ONLY the "Current context" block below — it includes a day-by-day layout with each day's start/lunch
time and what's actually placed, with lunch overlaps already flagged, so a question about a specific day
has a real answer there, not a guess. Never compute or guess a number, time, or overlap that isn't already
given to you there.

When an answer covers more than one item (a list of tasks, days, or reminders), format it rather than
writing a run-on paragraph: a short lead-in sentence, then one "- " bullet per item. If the answer has more
than one distinct section (e.g. reminders AND at-risk tasks), give each section a short "## Heading" line.
Use **bold** sparingly, for the one or two words that matter most in a line (a name, a number, "overdue").
A one-item or yes/no answer can stay a plain sentence — don't force structure where none is needed.

Before adding something due this week, or anything the user frames as urgent, check the free-capacity
figure already in the context block. If it doesn't comfortably fit, say so and talk through what to do
(add it anyway and flag what's now tight, move or split something else, push part to next week) BEFORE
calling propose_personal_tasks — don't silently add something you can already tell won't fit as asked.
This is conditional, not automatic: when there's plainly enough room, just add it in one step like
normal — don't manufacture a discussion that isn't needed. The same applies to the "Out of office /
locked" and "Standing rules" lines in the context block — notice a conflict and raise it before acting,
don't place something on a day or in a way you already know is blocked.

Nothing you propose is created yet — some tools apply immediately when the task name is unambiguous,
others still need a quick pick (which task?) or review card first, and you don't control which; that's
decided in code, after your message. So when you call a tool, write the accompanying sentence as intent,
not as a finished result — "I'll add these three to your list", "Moving the Arran edit to Thursday" — never
"I've added"/"Done" or anything else claiming it's already final. Phrased that way it reads naturally
whether it auto-applies or a review step follows, and you never end up repeating or contradicting the
app's own follow-up message once that step resolves. Make it specific (what and why), not a repeat of the
tool's own fields. Resolve relative dates ("Friday", "next Tuesday") against today's date, given in the
context block. Never decide which existing task a name refers to — that matching is done separately in
code; just pass along the name as the user wrote it.`;

export async function classifyChatMessage(
  message: string,
  contextBlock: string,
  history: ChatHistoryMessage[],
  options?: { includeEditTools?: boolean }
): Promise<ChatResponse> {
  const tools = options?.includeEditTools ? [...TOOLS, ...EDIT_TOOLS] : TOOLS;
  const response = await getClient().messages.create({
    model: env.anthropicModel(),
    max_tokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nCurrent context:\n${contextBlock}`,
    tools,
    tool_choice: { type: "auto" },
    messages: [...history, { role: "user", content: message }],
  });

  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const text = textBlocks.length > 0 ? textBlocks.map((b) => b.text).join("\n\n") : null;

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    // Pure conversation this turn — nothing to confirm or write.
    return { text: text ?? "", action: null };
  }

  const input = toolUse.input as Record<string, unknown>;
  const action = ((): ChatAction => {
    if (toolUse.name === "propose_personal_tasks") {
      return { type: "monday_list", items: input.items as MondayListItem[] };
    }
    if (toolUse.name === "propose_ideas") {
      return { type: "idea", items: input.items as { title: string }[] };
    }
    if (toolUse.name === "propose_priority_override") {
      return { type: "priority_override", taskName: input.taskName as string, newPriority: input.newPriority as string };
    }
    if (toolUse.name === "propose_plan_change") {
      return {
        type: "plan_change",
        taskName: input.taskName as string,
        newDay: input.newDay as string | null,
        newDurationHours: input.newDurationHours as number | null,
        durationDeltaHours: input.durationDeltaHours as number | null,
      };
    }
    if (toolUse.name === "propose_distribute_block") {
      return {
        type: "distribute_block",
        taskName: input.taskName as string,
        distribution: input.distribution as { day: string; hours: number | null }[],
      };
    }
    if (toolUse.name === "propose_must_change") {
      return { type: "must_change", taskName: input.taskName as string, must: input.must as boolean };
    }
    if (toolUse.name === "propose_remove_block") {
      return { type: "remove_block", taskName: input.taskName as string };
    }
    if (toolUse.name === "propose_park_change") {
      return { type: "park_change", taskName: input.taskName as string, parked: input.parked as boolean };
    }
    if (toolUse.name === "propose_set_estimate") {
      return { type: "set_estimate", taskName: input.taskName as string, hours: input.hours as number };
    }
    if (toolUse.name === "propose_split_block") {
      return {
        type: "split_block",
        taskName: input.taskName as string,
        hoursNow: input.hoursNow as number,
        remainder: input.remainder as "next-working-day" | "queue",
      };
    }
    if (toolUse.name === "propose_reprioritise_day") {
      return { type: "reprioritise_day", day: input.day as string | null };
    }
    if (toolUse.name === "propose_day_lock") {
      return { type: "day_lock", day: input.day as string, locked: input.locked as boolean, reason: input.reason as string | null };
    }
    if (toolUse.name === "propose_add_rule") {
      return { type: "add_rule", text: input.text as string };
    }
    if (toolUse.name === "ask_history") {
      return { type: "history_query", taskName: input.taskName as string | null, period: input.period as "month" | "quarter" | "all" };
    }
    throw new Error(`Unexpected tool: ${toolUse.name}`);
  })();

  return { text, action };
}

const SUGGEST_ESTIMATE_TOOL: Anthropic.Tool = {
  name: "suggest_estimate",
  description: "Suggest how many hours this task will likely take, given its name, stage and video type.",
  input_schema: {
    type: "object",
    properties: {
      hours: { type: "number", description: "A realistic estimate in hours, e.g. 2.5. Round to the nearest quarter hour." },
    },
    required: ["hours"],
    additionalProperties: false,
  },
  strict: true,
};

const SUGGEST_ESTIMATE_SYSTEM_PROMPT = `You suggest how many hours a video-production task will take, for a
solo video lead's weekly plan. You have no figure from the user, no learned figure from their past entries, and
no configured default for this exact combination — so you're the last resort before the task is left unestimated.
Give a plausible, conservative figure for the stage described. Always call the tool; never respond with plain text.`;

/**
 * v4 Stage 2, brief section 5.1, tier 4: "A model suggestion... If the
 * model is unavailable, list the task as 'needs estimate' and do not place
 * it." Returns null on any failure (network, parse, missing tool call) —
 * the caller treats that exactly like "no suggestion available."
 */
export async function suggestEstimateHours(taskName: string, stage: string | null, videoType: string | null): Promise<number | null> {
  try {
    const response = await getClient().messages.create({
      model: env.anthropicModel(),
      max_tokens: 200,
      system: SUGGEST_ESTIMATE_SYSTEM_PROMPT,
      tools: [SUGGEST_ESTIMATE_TOOL],
      // A forced tool_choice ("tool"/"any") isn't supported by every model
      // this app might be configured to use — "auto" is, and a single
      // available tool plus an instruction to always call it is reliable
      // enough in practice.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Task: ${taskName}\nStage: ${stage ?? "unknown"}\nVideo type: ${videoType ?? "unknown"}` }],
    });
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const hours = (toolUse?.input as { hours?: unknown } | undefined)?.hours;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) return null;
    return hours;
  } catch (err) {
    console.error(`suggestEstimateHours: model call failed for "${taskName}": ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

type RuleWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const RULE_WEEKDAYS: RuleWeekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type ParsedRule = { kind: "avoid_weekday"; weekday: RuleWeekday; stage: string | null } | { kind: "freeform" };

const PARSE_RULE_TOOL: Anthropic.Tool = {
  name: "parse_rule",
  description:
    "Classify a scheduling rule into a structured shape the auto-placement engine can enforce, or 'freeform' if it doesn't fit.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["avoid_weekday", "freeform"],
        description:
          "'avoid_weekday' only for a rule that names a specific weekday to avoid scheduling on (optionally restricted to one kind of work). 'freeform' for anything else — a vague preference, a rule naming a specific task instead of a weekday/stage, a date instead of a weekday, etc.",
      },
      weekday: {
        anyOf: [{ type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }, { type: "null" }],
        description: "Only when kind is 'avoid_weekday': the weekday to avoid. Null otherwise.",
      },
      stage: {
        type: ["string", "null"],
        description:
          "Only when kind is 'avoid_weekday' and the rule names a specific kind of work (e.g. 'Edit', 'Review'): that stage name, matched against this app's own stage names where possible. Null to mean the whole day, or when kind is 'freeform'.",
      },
    },
    required: ["kind", "weekday", "stage"],
    additionalProperties: false,
  },
  strict: true,
};

const PARSE_RULE_SYSTEM_PROMPT = `You classify one standing scheduling rule a user typed into a weekly-planning
app, so the app's deterministic auto-placement engine (plain code, not an LLM) can try to obey it. It can only
ever obey a narrow shape: "never schedule [a stage of work, or anything] on [a specific weekday]". Classify as
avoid_weekday ONLY when the rule clearly names a weekday (not a specific date, not "today", not a task name) to
avoid — with an optional stage filter if one kind of work is named. Everything else — a vague preference, a rule
about a specific task or project, a date, a priority/ordering preference, anything conditional — is freeform.
Be conservative: when genuinely unsure, choose freeform rather than guessing a constraint the user didn't mean.
Always call the tool; never respond with plain text.`;

/**
 * Called once, when a rule is added (not on every build) — see
 * app/(app)/settings/rules-actions.ts. Returns { kind: "freeform" } on any
 * failure (network, parse, missing tool call), same "safe default on
 * failure" convention suggestEstimateHours uses above: a rule that can't be
 * classified is never silently treated as enforced.
 */
export async function parseSchedulingRule(text: string): Promise<ParsedRule> {
  try {
    const response = await getClient().messages.create({
      model: env.anthropicModel(),
      max_tokens: 200,
      system: PARSE_RULE_SYSTEM_PROMPT,
      tools: [PARSE_RULE_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: text }],
    });
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const input = toolUse?.input as { kind?: unknown; weekday?: unknown; stage?: unknown } | undefined;
    if (input?.kind === "avoid_weekday" && typeof input.weekday === "string" && RULE_WEEKDAYS.includes(input.weekday as RuleWeekday)) {
      return { kind: "avoid_weekday", weekday: input.weekday as RuleWeekday, stage: typeof input.stage === "string" ? input.stage : null };
    }
    return { kind: "freeform" };
  } catch (err) {
    console.error(`parseSchedulingRule: model call failed for "${text}": ${err instanceof Error ? err.message : err}`);
    return { kind: "freeform" };
  }
}

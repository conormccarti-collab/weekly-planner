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

export type ChatClassification =
  | { type: "monday_list"; items: MondayListItem[] }
  | { type: "idea"; items: { title: string }[] }
  | { type: "answer"; answerText: string }
  | { type: "priority_override"; taskName: string; newPriority: string }
  | { type: "plan_change"; taskName: string; newDay: string | null; newDurationHours: number | null }
  | { type: "must_change"; taskName: string; must: boolean }
  | { type: "remove_block"; taskName: string }
  | { type: "park_change"; taskName: string; parked: boolean }
  | { type: "set_estimate"; taskName: string; hours: number };

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
    name: "answer_question",
    description:
      "Use when the user is asking a question that can be answered from the capacity/plan/task context supplied in this message. Only use numbers and facts present in that context — never compute or invent one.",
    input_schema: {
      type: "object",
      properties: { answerText: { type: "string" } },
      required: ["answerText"],
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
          description: "The new total duration in hours if the user wants to resize the block, or null if not mentioned (keep its current duration).",
        },
      },
      required: ["taskName", "newDay", "newDurationHours"],
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
];

const SYSTEM_PROMPT = `You are the chat assistant inside a personal weekly-planning app (brief section 9), docked on
the Week screen so it can edit the draft plan directly (v4 Stage 2, brief section 5.3).
You always respond by calling exactly one of the tools — never plain text.

- A pasted or typed list of non-Asana tasks ("Monday list") → propose_personal_tasks.
- Something idea-shaped, not an actionable task for this week → propose_ideas.
- A question about the user's week, tasks, or capacity (including "what's at risk?") → answer_question,
  using ONLY the "Current context" block below. Never compute or guess a number that isn't already there.
- A request to change how important an existing task is → propose_priority_override.
- A request to move and/or resize an existing placed task → propose_plan_change.
- A request to flag or clear a task's Must status → propose_must_change.
- A request to take a placed task off the calendar → propose_remove_block.
- A request to park or unpark a task → propose_park_change.
- The user giving or correcting a task's time estimate directly → propose_set_estimate.

Nothing you propose is created yet — the app always shows your proposal to the user for
confirmation first (a plan edit may confirm inline rather than through a full review card, but
that is decided in code, not by you). Resolve relative dates ("Friday", "next Tuesday") against
today's date, given in the context block. Never decide which existing task a name refers to —
that matching is done separately in code; just pass along the name as the user wrote it.`;

export async function classifyChatMessage(
  message: string,
  contextBlock: string,
  options?: { includeEditTools?: boolean }
): Promise<ChatClassification> {
  const tools = options?.includeEditTools ? [...TOOLS, ...EDIT_TOOLS] : TOOLS;
  const response = await getClient().messages.create({
    model: env.anthropicModel(),
    max_tokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nCurrent context:\n${contextBlock}`,
    tools,
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: message }],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("The model didn't return a structured proposal.");
  }

  const input = toolUse.input as Record<string, unknown>;
  if (toolUse.name === "propose_personal_tasks") {
    return { type: "monday_list", items: input.items as MondayListItem[] };
  }
  if (toolUse.name === "propose_ideas") {
    return { type: "idea", items: input.items as { title: string }[] };
  }
  if (toolUse.name === "answer_question") {
    return { type: "answer", answerText: input.answerText as string };
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
  throw new Error(`Unexpected tool: ${toolUse.name}`);
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

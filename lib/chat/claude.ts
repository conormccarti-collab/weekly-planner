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
  | { type: "plan_change"; taskName: string; newDay: string | null };

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
      "Use when the user wants to move or reschedule an already-placed task — e.g. 'Move the Arran edit to Thursday'. Never decide which existing task this refers to — that is done separately in code.",
    input_schema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "The task being referred to, in the user's own words." },
        newDay: {
          type: ["string", "null"],
          description: "The day to move it to, resolved to YYYY-MM-DD using today's date, or null if unclear.",
        },
      },
      required: ["taskName", "newDay"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const SYSTEM_PROMPT = `You are the chat assistant inside a personal weekly-planning app (brief section 9).
You always respond by calling exactly one of the tools — never plain text.

- A pasted or typed list of non-Asana tasks ("Monday list") → propose_personal_tasks.
- Something idea-shaped, not an actionable task for this week → propose_ideas.
- A question about the user's week, tasks, or capacity → answer_question, using ONLY the
  "Current context" block below. Never compute or guess a number that isn't already there.
- A request to change how important an existing task is → propose_priority_override.
- A request to move or reschedule an existing placed task → propose_plan_change.

Nothing you propose is created yet — the app always shows your proposal to the user for
confirmation first. Resolve relative dates ("Friday", "next Tuesday") against today's date,
given in the context block.`;

export async function classifyChatMessage(message: string, contextBlock: string): Promise<ChatClassification> {
  const response = await getClient().messages.create({
    model: env.anthropicModel(),
    max_tokens: 4096,
    system: `${SYSTEM_PROMPT}\n\nCurrent context:\n${contextBlock}`,
    tools: TOOLS,
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
    return { type: "plan_change", taskName: input.taskName as string, newDay: input.newDay as string | null };
  }
  throw new Error(`Unexpected tool: ${toolUse.name}`);
}

const SUMMARY_SYSTEM_PROMPT = `You turn a structured facts object about someone's work week into 2-3 plain, warm sentences.
Rules:
- Use only the facts given. Never add, change, or calculate any number, date, or time — copy them exactly as given.
- Never invent a task name or fact not present in the object.
- Cover, briefly and in this rough order: what's happening now (or that nothing is scheduled / outside working hours), what's next, today's planned-vs-capacity, anything at risk (only if the list is non-empty), and next week's planned-vs-capacity.
- Keep it to 2-3 sentences total. No preamble, no "Here's your summary", just the sentences.`;

/**
 * v3 (plan-first) stage 4, brief section 7: "The model turns the object
 * into two or three plain sentences. It may not add, change or calculate
 * any number or date." A one-shot plain-text call (no tools) — the caller
 * falls back to `templateSummary` from the same facts if this throws.
 */
export async function phraseWeekSummary(facts: unknown): Promise<string> {
  const response = await getClient().messages.create({
    model: env.anthropicModel(),
    max_tokens: 300,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
  });
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock || !textBlock.text.trim()) {
    throw new Error("The model didn't return any text.");
  }
  return textBlock.text.trim();
}

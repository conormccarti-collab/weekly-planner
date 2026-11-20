export type NotificationContent = {
  morningCheckOutstanding: string[];
  deadlineRisks: string[];
  hygieneIssues: string[];
};

/** Brief section 10: "Send nothing when there is nothing to report." */
export function hasAnythingToReport(content: NotificationContent): boolean {
  return content.morningCheckOutstanding.length > 0 || content.deadlineRisks.length > 0 || content.hygieneIssues.length > 0;
}

/**
 * Brief section 10: "the morning check still outstanding, deadline risks
 * ..., and any Hygiene flags on this week's deliverables." Each section is
 * omitted when empty, same convention as the week summary.
 */
export function renderNotificationEmail(content: NotificationContent, todayStr: string): { subject: string; text: string } {
  const parts: string[] = [];

  if (content.morningCheckOutstanding.length > 0) {
    parts.push(`Morning check still outstanding:\n${content.morningCheckOutstanding.map((l) => `- ${l}`).join("\n")}`);
  }
  if (content.deadlineRisks.length > 0) {
    parts.push(`Deadline risks:\n${content.deadlineRisks.map((l) => `- ${l}`).join("\n")}`);
  }
  if (content.hygieneIssues.length > 0) {
    parts.push(`Hygiene flags this week:\n${content.hygieneIssues.map((l) => `- ${l}`).join("\n")}`);
  }

  return {
    subject: `Weekly Planner — ${todayStr}`,
    text: parts.join("\n\n"),
  };
}

import { formatHHMM } from "@/lib/time";

export type PlanTextDay = { dateStr: string; label: string; isWorkingDay: boolean };
export type PlanTextBlock = { day: string; name: string; startMinutes: number; endMinutes: number; status: string };
export type PlanTextUnplaced = { name: string; estimateDisplay: string };

/** Release 1.1, brief section 10: "Copy this week's plan as plain text for pasting into Slack." */
export function formatPlanAsText(days: PlanTextDay[], blocks: PlanTextBlock[], unplaced: PlanTextUnplaced[]): string {
  const lines: string[] = [];

  for (const day of days.filter((d) => d.isWorkingDay)) {
    const dayBlocks = blocks
      .filter((b) => b.day === day.dateStr)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    lines.push(day.label);
    if (dayBlocks.length === 0) {
      lines.push("  (nothing placed)");
    } else {
      for (const block of dayBlocks) {
        const done = block.status === "done" ? " ✓" : "";
        lines.push(`  ${formatHHMM(block.startMinutes)}–${formatHHMM(block.endMinutes)} ${block.name}${done}`);
      }
    }
    lines.push("");
  }

  if (unplaced.length > 0) {
    lines.push("Unplaced:");
    for (const item of unplaced) {
      lines.push(`  - ${item.name} (${item.estimateDisplay})`);
    }
  }

  return lines.join("\n").trimEnd();
}

export type MorningCheckOutcome = "done" | "on_track" | "behind";

export type MorningCheckUpdate = {
  status: "done" | "planned" | "behind";
  actualHours: number | null;
  remainingHours: number | null;
};

/**
 * Release 1.1, brief section 10: "Morning check... Behind asks for hours
 * left." Done assumes it took the planned time; On track leaves the block
 * as planned (no record of actual time yet); Behind records how much is
 * left so the rest of the week can be re-placed.
 */
export function resolveMorningCheckUpdate(
  outcome: MorningCheckOutcome,
  plannedHours: number,
  hoursLeft: number | null
): MorningCheckUpdate {
  if (outcome === "done") {
    return { status: "done", actualHours: plannedHours, remainingHours: null };
  }
  if (outcome === "on_track") {
    return { status: "planned", actualHours: null, remainingHours: null };
  }
  const remaining = hoursLeft ?? plannedHours;
  return { status: "behind", actualHours: Math.max(0, plannedHours - remaining), remainingHours: remaining };
}

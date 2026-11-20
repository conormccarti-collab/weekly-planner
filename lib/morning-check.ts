export type MorningCheckOutcome = "done" | "on_track" | "behind" | "moved";

export type MorningCheckUpdate = {
  status: "done" | "planned" | "behind" | "moved";
  actualHours: number | null;
  remainingHours: number | null;
  /**
   * v4 Stage 2, brief 5.7: "Moved means re-plan this block, and it opens a
   * proposal." True only for "moved" — the caller clears day/time/pinned
   * on the row (reusing the same "moved" status the over-capacity path
   * already writes), which makes the task reappear as an unprotected
   * candidate the very next time the draft refreshes or the accepted
   * week's "Things have changed" diff runs — no separate proposal
   * machinery needed, it falls out of the existing one.
   */
  clearPlacement: boolean;
};

/**
 * Release 1.1, brief section 10 / v4 Stage 2, brief 5.7: "Morning check...
 * Behind asks for hours left... 'Moved' is its own answer... Moved means
 * re-plan this block." Done assumes it took the planned time; On track
 * leaves the block as planned; Behind records how much is left so the
 * rest of the week can be re-placed; Moved clears the placement entirely
 * rather than folding into On track.
 */
export function resolveMorningCheckUpdate(
  outcome: MorningCheckOutcome,
  plannedHours: number,
  hoursLeft: number | null
): MorningCheckUpdate {
  if (outcome === "done") {
    return { status: "done", actualHours: plannedHours, remainingHours: null, clearPlacement: false };
  }
  if (outcome === "on_track") {
    return { status: "planned", actualHours: null, remainingHours: null, clearPlacement: false };
  }
  if (outcome === "moved") {
    return { status: "moved", actualHours: null, remainingHours: null, clearPlacement: true };
  }
  const remaining = hoursLeft ?? plannedHours;
  return { status: "behind", actualHours: Math.max(0, plannedHours - remaining), remainingHours: remaining, clearPlacement: false };
}

/**
 * Brief rule 2, "arithmetic is code": chat can say a task should get "another
 * hour" without ever being asked to work out a new total itself — it has no
 * way to know the current duration (that's looked up from the database,
 * not given to the model), so a relative request is expressed as
 * `durationDeltaHours` and resolved here, in code, against the real figure.
 * An absolute request (`newDurationHours`) wins if both are somehow present.
 */
export function resolveNewDurationMinutes(
  oldDurationMinutes: number,
  newDurationHours: number | null | undefined,
  durationDeltaHours: number | null | undefined
): number {
  if (newDurationHours) return newDurationHours * 60;
  if (durationDeltaHours) return oldDurationMinutes + durationDeltaHours * 60;
  return oldDurationMinutes;
}

/**
 * Same principle for propose_distribute_block: "only Scott Dunn images this
 * weekend" (14h, 2 days, no numbers given) means an even split is obvious —
 * the model names the days with hours: null rather than inventing 7-and-7
 * itself, and this divides the real total (looked up from the database,
 * same as above) evenly across just the null entries, rounded to the
 * nearest 15 minutes with any rounding remainder absorbed by the last null
 * entry so the days still sum to exactly the real total. An explicit entry
 * is never touched — only entries the model left null get a share.
 */
/**
 * A day's buffer-reduced real capacity can be smaller than its even share
 * — Saturday's "half of 14h" can be more than Saturday actually has room
 * for once the buffer setting is honoured. Rather than erroring outright
 * (resolveDrop's redirect path only succeeds on an exact full fit, and
 * distribute_block deliberately can't let one day's overflow spill into
 * another day that has its own separate entry — see confirmDistributeBlock),
 * this caps each day at its real free capacity and carries whatever doesn't
 * fit forward to the next named day, same as a human splitting a task
 * across a week would. Anything still left over after the last named day
 * is returned as `leftoverHours`, for the caller to queue rather than drop.
 */
export function capDistributionToCapacity(
  distribution: { day: string; hours: number }[],
  freeHoursByDay: Map<string, number>
): { placements: { day: string; hours: number }[]; leftoverHours: number } {
  let carry = 0;
  const placements: { day: string; hours: number }[] = [];
  for (const { day, hours } of distribution) {
    const desired = hours + carry;
    const free = Math.max(0, freeHoursByDay.get(day) ?? 0);
    const toPlace = Math.min(desired, free);
    if (toPlace > 0) placements.push({ day, hours: toPlace });
    carry = desired - toPlace;
  }
  return { placements, leftoverHours: carry };
}

export function resolveEvenSplit(
  totalHours: number,
  distribution: { day: string; hours: number | null }[]
): { day: string; hours: number }[] {
  const explicitSum = distribution.reduce((sum, d) => sum + (d.hours ?? 0), 0);
  const nullCount = distribution.filter((d) => d.hours == null).length;
  if (nullCount === 0) return distribution.map((d) => ({ day: d.day, hours: d.hours as number }));

  const remaining = totalHours - explicitSum;
  const share = Math.round((remaining / nullCount) * 4) / 4; // nearest 0.25h
  let assignedToNulls = 0;
  let seenNulls = 0;
  return distribution.map((d) => {
    if (d.hours != null) return { day: d.day, hours: d.hours };
    seenNulls += 1;
    const isLastNull = seenNulls === nullCount;
    const hours = isLastNull ? Math.round((remaining - assignedToNulls) * 4) / 4 : share;
    assignedToNulls += hours;
    return { day: d.day, hours };
  });
}

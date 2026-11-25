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

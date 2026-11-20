/**
 * v4 Stage 5, brief section 8 / decisions 3.3: "Discovery grouping: by the
 * shared series name ('Series: Batch 1', 'Series: Ep 3')." A batch and its
 * episodes are separate Asana parent tasks that share a name prefix before
 * "Batch N" / "Ep N" — this just extracts that shared prefix so the UI can
 * group them under one heading. Returns null for anything that doesn't
 * match the pattern (an ordinary deliverable, not part of a series).
 */
export function seriesNameOf(taskName: string): string | null {
  const match = taskName.match(/^(.*?):\s*(?:Batch|Ep)\s*\d+\s*$/i);
  if (!match) return null;
  const series = match[1].trim();
  return series.length > 0 ? series : null;
}

export type SeriesGrouped<T> = { seriesName: string; items: T[] }[];

/**
 * Brief 8/3.3: "show them together under one series heading." Pure split
 * of an already-ordered list into series-named groups (sorted
 * alphabetically by series name) plus the leftover non-series items, kept
 * in their original relative order — the UI just renders each bucket.
 */
export function groupBySeries<T>(items: T[], seriesNameOfItem: (item: T) => string | null): { series: SeriesGrouped<T>; standalone: T[] } {
  const order: string[] = [];
  const byName = new Map<string, T[]>();
  const standalone: T[] = [];

  for (const item of items) {
    const name = seriesNameOfItem(item);
    if (!name) {
      standalone.push(item);
      continue;
    }
    if (!byName.has(name)) {
      order.push(name);
      byName.set(name, []);
    }
    byName.get(name)!.push(item);
  }

  order.sort((a, b) => a.localeCompare(b));
  return { series: order.map((seriesName) => ({ seriesName, items: byName.get(seriesName)! })), standalone };
}

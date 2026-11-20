/** v4 Stage 4b, brief 7.4.7: "Show results on the Week screen as a short 'Starts this week' list." */
export function StartsThisWeekList({
  items,
}: {
  items: { rootRef: string; deliverableName: string; stage: string; latestStartDate: string; isPastDue: boolean }[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-4 rounded border border-warning bg-warning-tint p-3 text-sm text-chalk">
      <p className="font-medium text-chalk">Starts this week (back-scheduled from publish dates)</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {items.map((item) => (
          <li key={`${item.rootRef}:${item.stage}`}>
            {item.deliverableName} — {item.stage}: start by {item.latestStartDate}
            {item.isPastDue && <span className="ml-1 font-medium text-danger">(already passed)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

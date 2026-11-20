"use client";

import { useState, useTransition } from "react";
import { pullIntoWeek } from "@/app/(app)/plan/actions";
import type { EverythingElseGroup } from "@/lib/planner-types";
import { groupBySeries } from "@/lib/asana/discovery";
import { ParkToggle } from "./park-toggle";

export function EverythingElseList({
  weekStart,
  groups,
  parkedGids,
}: {
  weekStart: string;
  groups: EverythingElseGroup[];
  parkedGids: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  const query = search.trim().toLowerCase();
  const filtered = query
    ? groups
        .map((g) => ({ ...g, tasks: g.tasks.filter((t) => t.name.toLowerCase().includes(query)) }))
        .filter((g) => g.rootName.toLowerCase().includes(query) || g.tasks.length > 0)
    : groups;

  // v4 Stage 5, brief 8/3.3: "Group a batch and its episodes by the shared
  // series name and show them together under one series heading."
  const { series: seriesGroups, standalone } = groupBySeries(filtered, (g) => g.seriesName);

  function addToWeek(source: "asana" | "personal", reference: string) {
    startTransition(() => {
      pullIntoWeek(weekStart, source, reference);
    });
  }

  return (
    <div className="mt-6">
      <button onClick={() => setExpanded((v) => !v)} className="text-sm font-semibold text-chalk">
        Everything else ({groups.length}) {expanded ? "▾" : "▸"}
      </button>
      {expanded && (
        <div className="mt-2">
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2 w-full max-w-xs rounded border border-border bg-slate px-2 py-1 text-sm text-chalk"
          />
          <ul className="divide-y divide-border">
            {seriesGroups.map(({ seriesName, items }) => (
              <li key={seriesName} className="py-2">
                <p className="text-sm font-semibold text-chalk">{seriesName}</p>
                <ul className="mt-1 divide-y divide-border pl-3">
                  {items.map((group) => (
                    <GroupItem key={group.rootRef} group={group} parkedGids={parkedGids} onAddToWeek={addToWeek} />
                  ))}
                </ul>
              </li>
            ))}
            {standalone.map((group) => (
              <GroupItem key={group.rootRef} group={group} parkedGids={parkedGids} onAddToWeek={addToWeek} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GroupItem({
  group,
  parkedGids,
  onAddToWeek,
}: {
  group: EverythingElseGroup;
  parkedGids: Set<string>;
  onAddToWeek: (source: "asana" | "personal", reference: string) => void;
}) {
  return (
    <li className="py-2">
      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="font-medium text-chalk">{group.rootName}</span>
          <span className="ml-2 text-xs text-chalk-dim">{group.projectName}</span>
        </div>
        <div className="flex items-center gap-2">
          {!group.isContainer && (
            <>
              <button onClick={() => onAddToWeek("asana", group.rootRef)} className="text-xs text-chalk-dim underline hover:text-chalk">
                Add to this week
              </button>
              <ParkToggle source="asana" reference={group.rootRef} parked={parkedGids.has(`asana:${group.rootRef}`)} />
            </>
          )}
        </div>
      </div>
      {group.nothingLeftToPlan && <p className="text-xs text-chalk-dim">nothing left to plan, check in Asana</p>}
      {group.tasks.length > 0 && (
        <ul className="mt-1 space-y-1 pl-3">
          {group.tasks.map((task) => (
            <li
              key={task.reference}
              className={`flex items-center justify-between text-xs text-chalk-dim ${
                parkedGids.has(`${task.source}:${task.reference}`) ? "opacity-40" : ""
              }`}
            >
              <span>
                {task.name} {task.stage && <span className="text-info">· {task.stage}</span>}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => onAddToWeek(task.source, task.reference)} className="text-chalk-dim underline hover:text-chalk">
                  Add to this week
                </button>
                <ParkToggle source={task.source} reference={task.reference} parked={parkedGids.has(`${task.source}:${task.reference}`)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

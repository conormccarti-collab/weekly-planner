"use client";

export function WeekTabs({ active, onChange }: { active: "this" | "next"; onChange: (tab: "this" | "next") => void }) {
  return (
    <div className="mb-3 inline-flex rounded-xl bg-surface-hover p-1">
      {(["this", "next"] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            active === tab ? "bg-slate text-chalk shadow-sm" : "text-chalk-dim hover:text-chalk"
          }`}
        >
          {tab === "this" ? "This week" : "Next week"}
        </button>
      ))}
    </div>
  );
}

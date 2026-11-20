"use client";

import { useTransition } from "react";
import { setParked } from "@/app/(app)/tasks/actions";

export function ParkToggle({
  source,
  reference,
  parked,
}: {
  source: "asana" | "personal";
  reference: string;
  parked: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-1 text-xs text-chalk-dim">
      <input
        type="checkbox"
        defaultChecked={parked}
        disabled={pending}
        onChange={(e) => startTransition(() => setParked(source, reference, e.target.checked))}
        className="h-3.5 w-3.5"
      />
      Park
    </label>
  );
}

"use client";

import { useState, useTransition } from "react";
import { updateEstimateDefault } from "@/app/(app)/settings/actions";

/** Brief section 9: "'Use as default' is a proposal. On approval it updates estimate_defaults... Never change a default automatically." */
export function UseAsDefaultButton({
  videoType,
  stage,
  variant,
  currentHours,
  suggestedHours,
}: {
  videoType: string;
  stage: string;
  variant: string;
  currentHours: number;
  suggestedHours: number;
}) {
  const [applied, setApplied] = useState(false);
  const [pending, startTransition] = useTransition();

  if (currentHours === suggestedHours) return null;

  return applied ? (
    <span className="text-xs text-success">Updated</span>
  ) : (
    <button
      onClick={() =>
        startTransition(async () => {
          await updateEstimateDefault(videoType, stage, variant, suggestedHours);
          setApplied(true);
        })
      }
      disabled={pending}
      className="ml-1 rounded border border-border px-1.5 py-0.5 text-xs text-chalk hover:bg-surface-hover disabled:opacity-50"
      title={`Change the ${variant || "default"} default from ${currentHours}h to ${suggestedHours}h`}
    >
      Use {suggestedHours}h{variant ? ` (${variant})` : ""}
    </button>
  );
}

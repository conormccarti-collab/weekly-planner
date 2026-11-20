"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setParked(source: "asana" | "personal", reference: string, parked: boolean) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  const { error } = await supabase.from("task_meta").upsert({
    user_id: user.id,
    source,
    reference,
    parked,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

/** Release 1.1, brief section 9: a priority override lives only in `task_meta` — Asana is never changed. */
export async function setPriorityOverride(source: "asana" | "personal", reference: string, priorityOverride: string | null) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  const { error } = await supabase.from("task_meta").upsert({
    user_id: user.id,
    source,
    reference,
    priority_override: priorityOverride,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function setTaskEstimate(
  source: "asana" | "personal",
  reference: string,
  hours: number,
  context: { stage: string | null; focusType: string | null; videoType: string | null }
) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("Estimate must be a non-negative number");
  }

  const { data: existing } = await supabase
    .from("task_meta")
    .select("estimate_hours")
    .eq("user_id", user.id)
    .eq("source", source)
    .eq("reference", reference)
    .maybeSingle();

  const { error: upsertError } = await supabase.from("task_meta").upsert({
    user_id: user.id,
    source,
    reference,
    stage: context.stage,
    focus_type: context.focusType,
    video_type: context.videoType,
    estimate_hours: hours,
    estimate_origin: "user",
    updated_at: new Date().toISOString(),
  });
  if (upsertError) {
    throw new Error(upsertError.message);
  }

  const { error: historyError } = await supabase.from("estimate_history").insert({
    user_id: user.id,
    source,
    reference,
    task_type_key: `${context.videoType ?? "none"}:${context.stage ?? "none"}`,
    old_hours: existing?.estimate_hours ?? null,
    new_hours: hours,
  });
  if (historyError) {
    throw new Error(historyError.message);
  }

  revalidatePath("/");
}

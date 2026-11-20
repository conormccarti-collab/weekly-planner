"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { completeTaskInAsana, setTaskDueDateInAsana } from "@/lib/asana/client";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

/**
 * Brief section 13 (Stage 10): "If [the token] lacks write permission, say
 * so and stop. Do not request a broader one." Asana returns 401/403 for an
 * insufficient-scope token — surfaced as a specific, actionable message
 * rather than a raw HTTP error, since this is the one failure mode the
 * brief calls out by name.
 */
function describeAsanaWriteError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b(401|403)\b/.test(message)) {
    return "The Asana token doesn't have permission to write. Check its permissions in Asana — this app won't request a broader one automatically.";
  }
  return `Asana write failed: ${message}`;
}

async function logWrite(
  supabase: SupabaseClient,
  userId: string,
  taskGid: string,
  field: "completed" | "due_on",
  oldValue: string | null,
  newValue: string
) {
  const { error } = await supabase.from("asana_writes").insert({
    user_id: userId,
    task_gid: taskGid,
    field,
    old_value: oldValue,
    new_value: newValue,
  });
  if (error) throw new Error(`Wrote to Asana but failed to log it: ${error.message}`);
}

/**
 * Brief section 13: "the morning check proposes completing a task the
 * user marked done in the app." Called only after the user approves the
 * proposal shown for this one task — "One task at a time. No bulk
 * approval," never as part of the batch morning-check submit itself.
 */
export async function approveCompleteTask(gid: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  try {
    await completeTaskInAsana(gid);
  } catch (err) {
    throw new Error(describeAsanaWriteError(err));
  }

  await logWrite(supabase, user.id, gid, "completed", "false", "true");
  await supabase.from("asana_tasks").update({ completed: true }).eq("gid", gid);
  revalidatePath("/");
}

/** Brief section 13: "moving a block past its due date proposes a new due date." */
export async function approveDueDateChange(gid: string, oldDueOn: string | null, newDueOn: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  try {
    await setTaskDueDateInAsana(gid, newDueOn);
  } catch (err) {
    throw new Error(describeAsanaWriteError(err));
  }

  await logWrite(supabase, user.id, gid, "due_on", oldDueOn, newDueOn);
  await supabase.from("asana_tasks").update({ due_on: newDueOn }).eq("gid", gid);
  revalidatePath("/");
}

/** Brief section 13: "Offer 'Restore previous value' for a date change." Itself a new approved write, logged the same way. */
export async function restoreDueDate(gid: string, previousDueOn: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: current } = await supabase.from("asana_tasks").select("due_on").eq("gid", gid).maybeSingle();

  try {
    await setTaskDueDateInAsana(gid, previousDueOn);
  } catch (err) {
    throw new Error(describeAsanaWriteError(err));
  }

  await logWrite(supabase, user.id, gid, "due_on", (current?.due_on as string | null) ?? null, previousDueOn);
  await supabase.from("asana_tasks").update({ due_on: previousDueOn }).eq("gid", gid);
  revalidatePath("/");
}

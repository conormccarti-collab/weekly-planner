"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

async function requireUser(supabase: SupabaseClient): Promise<User> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user;
}

/** Brief section 8.4: "An idea can be turned into a personal task or dropped." */
export async function convertIdeaToTask(
  ideaId: string,
  name: string,
  estimateHours: number | null,
  priority: string | null,
  dueOn: string | null
) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: task, error: insertError } = await supabase
    .from("personal_tasks")
    .insert({ user_id: user.id, name, estimate_hours: estimateHours, priority, due_on: dueOn })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const { error: updateError } = await supabase
    .from("ideas")
    .update({ status: "converted", converted_personal_task_id: task.id })
    .eq("id", ideaId)
    .eq("user_id", user.id);
  if (updateError) throw new Error(updateError.message);

  revalidatePath("/ideas");
  revalidatePath("/");
}

export async function dropIdea(ideaId: string) {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { error } = await supabase
    .from("ideas")
    .update({ status: "dropped" })
    .eq("id", ideaId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/ideas");
}

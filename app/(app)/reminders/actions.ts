"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dismissReminderById } from "@/lib/reminders";
import { loadSettings } from "@/lib/settings-data";

export async function dismissReminder(id: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error("Not signed in");

  await dismissReminderById(supabase, user.id, id);
  revalidatePath("/");
}

/**
 * The "Add to planned projects" action on a new-project reminder — resolves
 * it implicitly (loadReminders excludes any gid already in
 * planned_project_gids) rather than needing a separate retraction call.
 */
export async function addPlannedProject(gid: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error("Not signed in");

  const settings = await loadSettings(supabase, user.id);
  if (settings.planned_project_gids.includes(gid)) return;

  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: user.id, planned_project_gids: [...settings.planned_project_gids, gid] });
  if (error) throw new Error(error.message);

  revalidatePath("/");
}

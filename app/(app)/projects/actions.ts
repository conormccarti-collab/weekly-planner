"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveProjectNotes(projectName: string, notes: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("project_notes")
    .upsert({ user_id: user.id, project_name: projectName, notes, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${encodeURIComponent(projectName)}`);
}

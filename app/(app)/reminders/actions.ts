"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dismissReminderById } from "@/lib/reminders";

export async function dismissReminder(id: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error("Not signed in");

  await dismissReminderById(supabase, user.id, id);
  revalidatePath("/");
}

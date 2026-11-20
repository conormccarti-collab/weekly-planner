"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setDayStart(date: string, startTime: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    throw new Error("Not signed in");
  }

  const { error } = await supabase.from("day_starts").upsert({
    user_id: user.id,
    date,
    start_time: startTime,
    corrected: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

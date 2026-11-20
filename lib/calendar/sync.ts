import type { SupabaseClient } from "@supabase/supabase-js";
import { listPrimaryCalendarEvents, refreshAccessToken, ReconnectRequiredError } from "./client";
import { fullDaySpan, isAllDayEvent, isEventBusy, isOutOfOffice } from "./classify";
import { decrypt } from "@/lib/crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { addDaysToDateStr, localToUtcInstant, mondayOf, utcInstantToLocal } from "@/lib/time";

export async function runCalendarSync(supabase: SupabaseClient, userId: string, timezone: string) {
  const startedAt = new Date().toISOString();

  try {
    // oauth_tokens has no RLS policies at all (Stage 1 design) — only the
    // service-role key can read the encrypted refresh token, never the
    // user's own session client.
    const { data: tokenRow } = await createServiceRoleClient()
      .from("oauth_tokens")
      .select("refresh_token_encrypted")
      .eq("user_id", userId)
      .eq("provider", "google_calendar")
      .maybeSingle();

    if (!tokenRow) {
      throw new ReconnectRequiredError("No calendar connection on file");
    }

    const refreshToken = decrypt(tokenRow.refresh_token_encrypted);
    const accessToken = await refreshAccessToken(refreshToken);

    const todayStr = utcInstantToLocal(new Date(), timezone).dateStr;
    const weekStart = mondayOf(todayStr);
    const weekEndExclusive = addDaysToDateStr(weekStart, 7);
    const timeMin = localToUtcInstant(weekStart, 0, timezone).toISOString();
    const timeMax = localToUtcInstant(weekEndExclusive, 0, timezone).toISOString();

    const events = await listPrimaryCalendarEvents(accessToken, timeMin, timeMax);

    const rows = events.map((event) => {
      // A true all-day event and an Out of Office event (brief section 7's
      // "leave day") both block the whole day, just with different wire
      // shapes — normalise both to the same all_day/start_date/end_date form.
      const blocksWholeDay = isAllDayEvent(event) || isOutOfOffice(event);
      const span = blocksWholeDay ? fullDaySpan(event, timezone) : null;
      const allDay = !!span;
      const self = event.attendees?.find((a) => a.self);
      return {
        user_id: userId,
        event_id: event.id,
        title: event.summary ?? "(no title)",
        starts_at: allDay ? null : (event.start?.dateTime ?? null),
        ends_at: allDay ? null : (event.end?.dateTime ?? null),
        all_day: allDay,
        start_date: span?.startDate ?? null,
        end_date: span?.endDateExclusive ?? null,
        busy: isEventBusy(event),
        response_status: self?.responseStatus ?? null,
        last_synced_at: new Date().toISOString(),
      };
    });

    // Upsert (not delete+insert) so two overlapping syncs — e.g. the 15-minute
    // timer firing just as a manual Refresh completes — can never collide on
    // the same primary key the way a delete-then-insert pair can.
    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("calendar_events")
        .upsert(rows, { onConflict: "user_id,event_id" });
      if (upsertError) throw new Error(upsertError.message);
    }

    // Then drop anything that was cached for this week but Google no longer
    // returns (cancelled or moved out of range) — events not busy are kept,
    // since they're not shown, only deletions/moves need removing.
    const freshIds = rows.map((r) => r.event_id);
    const notInFresh = freshIds.length > 0 ? `(${freshIds.join(",")})` : "()";

    const { error: staleAllDayError } = await supabase
      .from("calendar_events")
      .delete()
      .eq("user_id", userId)
      .gte("start_date", weekStart)
      .lt("start_date", weekEndExclusive)
      .not("event_id", "in", notInFresh);
    if (staleAllDayError) throw new Error(staleAllDayError.message);

    const { error: staleTimedError } = await supabase
      .from("calendar_events")
      .delete()
      .eq("user_id", userId)
      .gte("starts_at", timeMin)
      .lt("starts_at", timeMax)
      .not("event_id", "in", notInFresh);
    if (staleTimedError) throw new Error(staleTimedError.message);

    await supabase.from("sync_log").insert({
      user_id: userId,
      source: "calendar",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
    });

    return { ok: true as const, eventCount: rows.length, weekStart };
  } catch (err) {
    const needsReconnect = err instanceof ReconnectRequiredError;
    const message = err instanceof Error ? err.message : "Unknown sync error";
    await supabase.from("sync_log").insert({
      user_id: userId,
      source: "calendar",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: false,
      error: needsReconnect ? "RECONNECT_REQUIRED" : message,
    });
    return { ok: false as const, error: message, needsReconnect };
  }
}

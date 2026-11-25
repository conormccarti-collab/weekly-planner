// Synthetic personal-task fixtures for the Week-list e2e specs, created and
// deleted around each test — never touches the user's real plan rows. See
// __tests__/e2e/README.md for why these land on real "next week" dates
// rather than a literal reserved-future week: the app has no week-
// navigation, so a 2099-dated row would never actually render for a test to
// interact with.
//
// Isolation:
// 1. Every fixture task's name is prefixed FIXTURE_MARKER, so it's
//    unmistakable at a glance in the DB or the UI.
// 2. Fixtures are "personal" tasks, never touching asana_tasks or any real
//    Asana-synced row.
// 3. assertIsFixtureBlock refuses to let a test act on any block id that
//    isn't one of the handles it was just given — a spec can't accidentally
//    act on a real block just because a selector happened to match it too.
// 4. Every spec deletes its own fixtures in a finally block, regardless of
//    pass/fail.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Playwright compiles .ts spec/helper files as CommonJS, unlike
// scripts/e2e-login.mjs (a real ESM file, where import.meta.url is used
// instead) — __dirname is the CJS equivalent, available here without import.
config({ path: `${__dirname}/../../.env.local` });

export const FIXTURE_MARKER = "[E2E-FIXTURE]";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.ALLOWED_EMAIL;

function adminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !EMAIL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ALLOWED_EMAIL in .env.local");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function fixtureUserId(db: ReturnType<typeof adminClient>): Promise<string> {
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === EMAIL);
  if (!user) throw new Error(`No Supabase user found for ${EMAIL}`);
  return user.id;
}

function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = Math.floor(minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function mondayOf(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const weekday = WEEKDAY_ORDER[(jsDay + 6) % 7];
  return addDays(dateStr, -WEEKDAY_ORDER.indexOf(weekday));
}

/**
 * Same date math as lib/time.ts (mondayOf/weekdayOfDateStr), reimplemented
 * standalone rather than imported — this file runs outside the Next.js
 * module graph. Matches what the live page will actually render as "Next
 * week", so fixtures created against this date always show up.
 */
export function nextWeekMonday(timezone = process.env.APP_TIMEZONE || "Europe/London"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const todayStr = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
  return addDays(mondayOf(todayStr), 7);
}

export type FixtureBlockSpec = {
  /** Without the marker — it's added automatically. */
  name: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
  pinned?: boolean;
  done?: boolean;
};

export type FixtureHandle = { taskId: string; blockId: string; name: string };

export async function createFixtureBlocks(weekStart: string, specs: FixtureBlockSpec[]): Promise<FixtureHandle[]> {
  const db = adminClient();
  const userId = await fixtureUserId(db);
  const handles: FixtureHandle[] = [];

  for (const spec of specs) {
    const name = `${FIXTURE_MARKER} ${spec.name}`;
    const { data: task, error: taskError } = await db.from("personal_tasks").insert({ user_id: userId, name }).select("id").single();
    if (taskError) throw taskError;

    const { data: block, error: blockError } = await db
      .from("plan_items")
      .insert({
        user_id: userId,
        week_start: weekStart,
        source: "personal",
        reference: task.id,
        day: spec.day,
        start_time: formatHHMM(spec.startMinutes),
        end_time: formatHHMM(spec.endMinutes),
        hours: (spec.endMinutes - spec.startMinutes) / 60,
        must: false,
        status: spec.done ? "done" : "planned",
        pinned: spec.pinned ?? false,
      })
      .select("id")
      .single();
    if (blockError) throw blockError;

    handles.push({ taskId: task.id as string, blockId: block.id as string, name });
  }

  return handles;
}

/** Creates one unplaced (day: null) fixture task — for dragging from the Unplaced list. */
export async function createUnplacedFixture(weekStart: string, name: string): Promise<FixtureHandle> {
  const db = adminClient();
  const userId = await fixtureUserId(db);
  const fullName = `${FIXTURE_MARKER} ${name}`;

  const { data: task, error: taskError } = await db.from("personal_tasks").insert({ user_id: userId, name: fullName, estimate_hours: 1 }).select("id").single();
  if (taskError) throw taskError;

  const { data: block, error: blockError } = await db
    .from("plan_items")
    .insert({ user_id: userId, week_start: weekStart, source: "personal", reference: task.id, day: null, hours: null, must: false, status: "planned" })
    .select("id")
    .single();
  if (blockError) throw blockError;

  return { taskId: task.id as string, blockId: block.id as string, name: fullName };
}

/** Converts a local wall-clock time on `day` to a UTC instant, by iterating against the zone's actual offset (handles GMT/BST without a date library). */
function zonedTimeToUtcISO(day: string, minutesFromMidnight: number, timezone: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const hh = Math.floor(minutesFromMidnight / 60);
  const mm = minutesFromMidnight % 60;
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    const hour = get("hour") % 24;
    const observed = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"));
    guess += target - observed;
  }
  return new Date(guess).toISOString();
}

export type FixtureMeetingHandle = { eventId: string };

/** A synthetic busy calendar event, isolated the same way (deletable, unmistakably marked) — for "drop onto a meeting" specs that shouldn't depend on the real calendar. */
export async function createFixtureMeeting(day: string, startMinutes: number, endMinutes: number, timezone = process.env.APP_TIMEZONE || "Europe/London"): Promise<FixtureMeetingHandle> {
  const db = adminClient();
  const userId = await fixtureUserId(db);
  const eventId = `e2e-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { error } = await db.from("calendar_events").insert({
    user_id: userId,
    event_id: eventId,
    title: `${FIXTURE_MARKER} Meeting`,
    starts_at: zonedTimeToUtcISO(day, startMinutes, timezone),
    ends_at: zonedTimeToUtcISO(day, endMinutes, timezone),
    all_day: false,
    busy: true,
  });
  if (error) throw error;

  return { eventId };
}

export async function deleteFixtureMeeting(handle: FixtureMeetingHandle): Promise<void> {
  const db = adminClient();
  const userId = await fixtureUserId(db);
  await db.from("calendar_events").delete().eq("user_id", userId).eq("event_id", handle.eventId);
}

export type FixtureRowState = { day: string | null; startMinutes: number | null; endMinutes: number | null; pinned: boolean; status: string };

function parseHHMMLocal(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Every current plan_items row for one fixture task — a multi-part split produces more than one, with fresh ids the test never saw, so this reads by task reference rather than a single blockId. */
export async function getFixtureTaskRows(taskId: string): Promise<FixtureRowState[]> {
  const db = adminClient();
  const { data, error } = await db.from("plan_items").select("day, start_time, end_time, pinned, status").eq("source", "personal").eq("reference", taskId);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    day: r.day as string | null,
    startMinutes: r.start_time ? parseHHMMLocal(r.start_time as string) : null,
    endMinutes: r.end_time ? parseHHMMLocal(r.end_time as string) : null,
    pinned: r.pinned as boolean,
    status: r.status as string,
  }));
}

export async function deleteFixtures(handles: FixtureHandle[]): Promise<void> {
  if (handles.length === 0) return;
  const db = adminClient();
  const taskIds = handles.map((h) => h.taskId);
  await db.from("plan_items").delete().in("reference", taskIds);
  await db.from("personal_tasks").delete().in("id", taskIds);
}

/**
 * The isolation guard: refuses to let a test proceed against any block id
 * that isn't one of the fixtures it was just handed. Call this before any
 * drag/move/edit helper acts on a `data-plan-block` id read from the page.
 */
export function assertIsFixtureBlock(blockId: string, handles: FixtureHandle[]): void {
  if (!handles.some((h) => h.blockId === blockId)) {
    throw new Error(`Refusing to act on block ${blockId} — it is not one of this test's fixtures (${FIXTURE_MARKER}).`);
  }
}

/**
 * A second, independent safety net: after a test's drag(s), confirm nothing
 * outside its own fixture tasks got touched at all — catches a test bug
 * (e.g. a stale bounding box after a mid-drag scroll landing the pointer on
 * a real block) that the id-based guard above can miss, since that guard
 * only checks what the test *intended* to act on, not what the server
 * actually received. `since` should be captured right before the test's
 * first drag.
 */
export async function assertNoRealDataTouched(since: Date, fixtureTaskIds: string[]): Promise<void> {
  const db = adminClient();
  const { data, error } = await db.from("plan_items").select("id, source, reference, updated_at").gt("updated_at", since.toISOString());
  if (error) throw error;
  const unexpected = (data ?? []).filter((r) => !fixtureTaskIds.includes(r.reference as string));
  if (unexpected.length > 0) {
    throw new Error(
      `Test touched non-fixture plan_items row(s), which must never happen: ${JSON.stringify(unexpected)}. ` +
        `Restore these manually from the app's own history/UI before trusting this data again.`
    );
  }
}

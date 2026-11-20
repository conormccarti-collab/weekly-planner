"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ReconnectCalendarButton } from "./reconnect-calendar-button";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

// Survives remounts within the same page load (e.g. a Server Action's
// revalidatePath re-rendering this component) so "sync when the app opens"
// fires once per real app open, not on every unrelated re-render.
let hasAutoSyncedThisLoad = false;

function formatAge(iso: string | null, now: number): string {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

export type SyncSourceStatus = {
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  needsReconnect?: boolean;
};

export function SyncBar({
  asana,
  calendar,
}: {
  asana: SyncSourceStatus;
  calendar: SyncSourceStatus;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [asanaError, setAsanaError] = useState<string | null>(asana.lastSyncError);
  const [calendarError, setCalendarError] = useState<string | null>(calendar.lastSyncError);
  const [needsReconnect, setNeedsReconnect] = useState(calendar.needsReconnect ?? false);
  // Relative "X minutes ago" text depends on Date.now() at render time, which
  // differs between the server render and client hydration — computing it
  // unconditionally caused a hydration mismatch. Rendering a fixed
  // placeholder until mount (then ticking every 30s) keeps the first client
  // render identical to the server's and moves the real clock to the client.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  async function sync() {
    setSyncing(true);
    setAsanaError(null);
    setCalendarError(null);
    try {
      const [asanaRes, calendarRes] = await Promise.all([
        fetch("/api/sync/asana", { method: "POST" }).then((r) => r.json()),
        fetch("/api/sync/calendar", { method: "POST" }).then((r) => r.json()),
      ]);
      if (!asanaRes.ok) setAsanaError(asanaRes.error ?? "Sync failed");
      if (!calendarRes.ok) {
        setCalendarError(calendarRes.error ?? "Sync failed");
        setNeedsReconnect(!!calendarRes.needsReconnect);
      } else {
        setNeedsReconnect(false);
      }
    } catch {
      setAsanaError("Sync failed");
      setCalendarError("Sync failed");
    } finally {
      setSyncing(false);
      router.refresh();
    }
  }

  useEffect(() => {
    // queueMicrotask (not setTimeout) so React's dev-mode double-invoke
    // (mount -> cleanup -> mount) can't cancel the scheduled call and leave
    // the flag set with no sync having actually run.
    if (!hasAutoSyncedThisLoad) {
      hasAutoSyncedThisLoad = true;
      queueMicrotask(sync);
    }
    const interval = setInterval(sync, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-chalk-dim">
        Asana: {syncing ? "syncing…" : now === null ? "—" : formatAge(asana.lastSyncedAt, now)}
      </span>
      <span className="text-chalk-dim">
        Calendar: {syncing ? "syncing…" : now === null ? "—" : formatAge(calendar.lastSyncedAt, now)}
      </span>
      <button
        onClick={sync}
        disabled={syncing}
        className="rounded border border-border px-2 py-1 text-xs font-medium text-chalk hover:bg-surface-hover disabled:opacity-50"
      >
        Refresh
      </button>
      {asanaError && <span className="text-danger">Asana sync failed: {asanaError}.</span>}
      {needsReconnect ? (
        <span className="flex items-center gap-2 text-danger">
          Calendar connection expired.
          <ReconnectCalendarButton />
        </span>
      ) : (
        calendarError && <span className="text-danger">Calendar sync failed: {calendarError}.</span>
      )}
    </div>
  );
}

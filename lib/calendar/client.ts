import { env } from "@/lib/env";
import type { GoogleCalendarEvent } from "./types";

// Rule 1 (brief section 2): the app never creates, edits, completes or
// deletes anything in Google Calendar — the scope is calendar.readonly.
// The one POST here is a standard OAuth token refresh (no calendar data
// touched); listing events is GET only.
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export class ReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconnectRequiredError";
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.googleOauthClientId(),
    client_secret: env.googleOauthClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    if (json.error === "invalid_grant") {
      throw new ReconnectRequiredError("Calendar connection expired or was revoked");
    }
    throw new Error(`Google token refresh failed: ${response.status} ${JSON.stringify(json)}`);
  }

  const json = await response.json();
  return json.access_token as string;
}

export async function listPrimaryCalendarEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<GoogleCalendarEvent[]> {
  const url = new URL(EVENTS_URL);
  url.searchParams.set("timeMin", timeMinIso);
  url.searchParams.set("timeMax", timeMaxIso);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ReconnectRequiredError("Calendar access token was rejected");
    }
    const body = await response.text().catch(() => "");
    throw new Error(`Google Calendar GET failed: ${response.status} ${body}`);
  }

  const json = await response.json();
  return json.items ?? [];
}

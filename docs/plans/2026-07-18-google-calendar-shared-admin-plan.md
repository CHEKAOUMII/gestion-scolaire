# Google Calendar Integration — Single Admin-Managed Shared Calendar

Last updated: 2026-07-18
Status: Draft / options analysis

## Goal

Show upcoming events from **one shared calendar** that the application admin controls.
End users do **not** connect their own Google accounts and do **not** see a Google
consent screen. Every user sees the same admin-curated events (school activities,
exams, meetings, holidays).

## Core constraint (read first)

Pencil2 is an Electron desktop app that ships to many machines. **Anything bundled
inside the app can be extracted by any user** — installer contents, `asar` archives,
and renderer code are all readable.

Therefore:

- Do **not** ship a service-account private key inside the app.
- Do **not** ship an OAuth client secret or a long-lived refresh token inside the app.
- Any secret that grants calendar access must live on a server the admin controls,
  or the calendar must be safe to expose read-only.

This single constraint decides which option fits.

## Options at a glance

| Option | Secret location | Private events | Needs backend | Best fit |
|---|---|---:|---:|---|
| A. Service account + shared calendar (backend) | Backend | Yes | Yes | Recommended when a server exists |
| B. Admin one-time OAuth, token on backend | Backend | Yes | Yes | Admin uses a normal Google account |
| C. Secret ICS feed URL | The URL itself | Yes (if URL kept secret) | No (optional) | Simplest; read-only import |
| D. Public calendar + API key | API key (low value) | No | No | Only if events are truly public |

Options A and B require a backend but keep events private and give the admin real
control. Options C and D need no backend but weaken privacy or control.

---

## Option A — Service account + shared calendar (recommended with a backend)

A service account is a Google machine identity. It has **no calendar access by
default**. The admin explicitly shares one calendar with the service account's email,
and from then on the service account can read exactly that calendar — nothing else.

### Setup

1. In Google Cloud, create a project and enable the Google Calendar API.
2. Create a **service account** and generate a JSON key.
3. Store the JSON key **only on the backend** (secret manager or env var). Never in
   the Electron bundle, repo, or client logs.
4. The admin creates or picks one Google Calendar and copies its **Calendar ID**
   (Calendar settings → "Integrate calendar" → Calendar ID).
5. The admin shares that calendar with the service account's email address
   (`...@<project>.iam.gserviceaccount.com`) using **"See all event details"**
   (read-only) access.

### Runtime flow

```text
Electron (renderer)
   -> window.api.calendar.getUpcoming()
Preload / contextBridge -> IPC
Electron main
   -> backend request (HTTPS, app-authenticated)
Backend
   -> service account auth -> Google Calendar API (that one calendar)
   -> normalized events
Electron main -> renderer (sanitized event DTOs)
```

The backend authenticates as the service account, calls `events.list` on the shared
Calendar ID, and returns normalized events. Electron never sees Google credentials.

### Scope

Request the least privilege:

```text
https://www.googleapis.com/auth/calendar.events.readonly
```

Reference: [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).

### Note on attendees / invites

A plain service account can read and manage events on a calendar shared with it, but
it **cannot invite attendees** without Google Workspace domain-wide delegation. For a
read-only "show upcoming events" feature this limitation does not apply.

---

## Option B — Admin one-time OAuth, refresh token on backend

If the admin prefers to use a normal Google account (not a service account), the admin
authorizes **once**, and the backend stores the resulting refresh token.

### Setup

1. Enable the Google Calendar API in Google Cloud.
2. Configure the OAuth consent screen.
3. Create an OAuth client (Web or Desktop, depending on where the callback runs).
4. The admin completes the OAuth flow one time, granting
   `calendar.events.readonly`.
5. The backend stores the **refresh token** securely and uses it to mint access
   tokens for API calls.

### Trade-offs vs Option A

- Events come from the admin's own calendar / any calendar that account can read.
- Refresh tokens can be revoked by the account owner or expire; handle reconnection.
- Reading Calendar events is a **sensitive scope**; a publicly distributed OAuth app
  may require Google verification. See
  [sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

Option A is usually cleaner for an app-owned shared calendar because access is not
tied to a personal account.

---

## Option C — Secret ICS feed URL (no backend required)

Google Calendar can expose a calendar as a private `.ics` (iCalendar) feed with a
secret address. The app periodically downloads and parses it.

### Setup

1. The admin opens the calendar's settings and copies the **secret iCal address**
   (a private `.ics` URL).
2. Store that URL as an admin-configured setting (treat it as a secret).
3. The app (Electron main, or backend) fetches and parses the feed on a schedule.

### Trade-offs

- Anyone with the secret URL can read the whole calendar — it functions like a
  password. Store it as a secret; do not commit it or expose it to the renderer.
- One-way, read-only import; refresh timing can lag behind Google.
- You must parse iCalendar yourself: recurrence rules (`RRULE`), time zones,
  exceptions, and cancelled occurrences all need handling.
- No fine-grained revocation beyond rotating the URL.

This is the simplest option and needs no Google API client. It fits well when the
admin can paste a URL and the events are not highly sensitive.

---

## Option D — Public calendar + API key (only if events are public)

If the calendar is intentionally public, the app can read it with the Calendar ID and
an API key.

```http
GET https://www.googleapis.com/calendar/v3/calendars/CALENDAR_ID/events
    ?key=API_KEY
    &timeMin=<now ISO8601>
    &singleEvents=true
    &orderBy=startTime
    &maxResults=20
```

### Trade-offs

- Cannot read private events; the calendar must be made public.
- An API key embedded in the desktop app can be extracted, so restrict the key and
  rely on quotas. Prefer proxying through a backend if one exists.
- Do **not** make a private calendar public just to simplify integration.

---

## The events request (Options A, B, D)

```http
GET https://www.googleapis.com/calendar/v3/calendars/CALENDAR_ID/events
    ?timeMin=<now ISO8601>
    &singleEvents=true
    &orderBy=startTime
    &maxResults=20
```

Authorization header (Options A and B):

```http
Authorization: Bearer ACCESS_TOKEN
```

Normalizing the response:

```js
const params = new URLSearchParams({
  timeMin: new Date().toISOString(),
  singleEvents: 'true',
  orderBy: 'startTime',
  maxResults: '20'
});

const url =
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${accessToken}` }
});

if (!response.ok) {
  throw new Error(`Google Calendar request failed: ${response.status}`);
}

const result = await response.json();

const events = (result.items || []).map((event) => ({
  id: event.id,
  title: event.summary || 'Untitled event',
  start: event.start?.dateTime || event.start?.date,
  end: event.end?.dateTime || event.end?.date,
  allDay: Boolean(event.start?.date),
  location: event.location || null,
  status: event.status,
  calendarLink: event.htmlLink
}));
```

Key parameters:

- `timeMin` — excludes events that already ended.
- `singleEvents=true` — expands recurring events into individual occurrences.
- `orderBy=startTime` — valid only when `singleEvents=true`.
- `maxResults` — page size; default is 250, maximum is 2500.
- `pageToken` — follow `nextPageToken` when results span multiple pages.

Reference: [`events.list`](https://developers.google.com/google-apps/calendar/v3/reference/events/list).

---

## Keeping events fresh

Authentication and refresh strategy are independent choices.

- **Manual / on-open**: fetch when the calendar screen opens or on a Refresh action.
  Best first implementation.
- **Polling**: refetch every 5–15 minutes while the app runs; back off on errors and
  skip while offline.
- **Incremental sync**: full sync once, save `nextSyncToken`, then request only
  changes with `syncToken`. On HTTP `410`, discard the token and do a full sync.
  Reference: [Synchronize resources efficiently](https://developers.google.com/google-apps/calendar/v3/sync).
- **Push notifications (webhooks)**: Google can `watch` a calendar and POST to a
  **public HTTPS endpoint** — it cannot push directly to Electron on localhost, so it
  requires the backend. Reference:
  [Push notifications](https://developers.google.com/calendar/v3/push).

For a single shared calendar shown to users, **on-open fetch plus periodic polling**
is usually enough.

---

## Recommendation

- If a backend exists (or Option B's server for firebase/sync is available):
  use **Option A — service account + one shared calendar**, read-only scope, events
  fetched by the backend and returned to Electron as sanitized DTOs.
- If no backend is available and events are not highly sensitive:
  use **Option C — secret ICS feed**, stored as an admin secret, parsed on a schedule.
- Use **Option D** only when the calendar is genuinely public.

Whatever the choice: no Google secret, OAuth client secret, refresh token, or
service-account key may ship inside the Electron bundle or reach the renderer.

## Electron wiring (applies to A, B, C-via-main)

Keep credentials and network calls in the main process; expose a narrow IPC surface.

```text
Renderer
   -> window.api.calendar.getUpcoming({ limit })
Preload / contextBridge -> IPC
main/ipc/calendar.js            (auth + validation only)
main/integrations/google-calendar/
├── client.js                   (fetch/normalize)
├── config-store.js             (calendar id / secret ICS url / backend url)
└── event-mapper.js             (Google event -> app DTO)
```

Return only sanitized event fields to the renderer. Do not expose tokens, secret
URLs, service-account keys, or raw HTTP methods across IPC. If a write channel is
added later, follow `docs/plans/2026-07-15-add-write-channel-checklist.md`.

---

Content derived from Google documentation was rephrased for compliance with licensing restrictions.

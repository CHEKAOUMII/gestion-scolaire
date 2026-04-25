# Owner Telemetry Server

This server collects device check-ins from installed app clients so the owner can see all machines in one dashboard.

## Run

```bash
npm run owner:server
```

## Environment Variables

- `PORT` (default: `8787`)
- `OWNER_SYNC_WRITE_TOKEN` (required in production for client check-ins)
- `OWNER_SYNC_READ_TOKEN` (recommended for admin dashboard reads)
- `OWNER_SYNC_TOKEN` (legacy fallback if split tokens are not set)
- `OWNER_DB_PATH` (optional custom JSON data path)

Example:

```bash
set OWNER_SYNC_WRITE_TOKEN=my-write-token && set OWNER_SYNC_READ_TOKEN=my-read-token && npm run owner:server
```

## API

- `GET /api/health`
- `POST /api/telemetry/register`
- `POST /api/telemetry/heartbeat`
- `GET /api/telemetry/overview`
- `GET /api/telemetry/devices?limit=100`
- `GET /api/telemetry/auth-check?scope=write|read`

Telemetry endpoints require header:

`x-owner-token: <token>`

Authorization rules:

- `POST /api/telemetry/register` and `POST /api/telemetry/heartbeat`
  - allow write token or read token
- `GET /api/telemetry/overview` and `GET /api/telemetry/devices`
  - allow read token only

Data is stored in a local JSON file by default:

- `server/owner-telemetry.json`

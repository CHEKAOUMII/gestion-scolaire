# Pencil2 Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-23

## Active Technologies

- JavaScript on Electron 35 with Node.js runtime and vanilla renderer scripts + Electron IPC/contextBridge, `better-sqlite3`, Node built-ins (`crypto`, `dgram`, `http`, `os`), existing auth/licensing/sync/linking modules (013-ipc-layer)

## Project Structure

```text
src/
tests/
```

## Commands

npm test; npm run lint

## Code Style

JavaScript on Electron 35 with Node.js runtime and vanilla renderer scripts: Follow standard conventions

## Recent Changes

- 013-ipc-layer: Added JavaScript on Electron 35 with Node.js runtime and vanilla renderer scripts + Electron IPC/contextBridge, `better-sqlite3`, Node built-ins (`crypto`, `dgram`, `http`, `os`), existing auth/licensing/sync/linking modules

<!-- MANUAL ADDITIONS START -->

## System Tags Architecture

A note-based tagging system for recording structured daily observations about teachers and sections using `@mention` autocomplete.

### Database: `system_tags` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `tag_date` | TEXT NOT NULL | Date (YYYY-MM-DD) |
| `entity_type` | TEXT NOT NULL | `'teacher'` or `'section'` |
| `entity_id` | INTEGER | Teacher ID (NULL for sections) |
| `entity_name` | TEXT NOT NULL | Teacher name or section code |
| `tag_key` | TEXT NOT NULL | Tag identifier (e.g. `educational_activity`) |
| `tag_label` | TEXT NOT NULL | Arabic display label |
| `note_group` | TEXT | UUID linking rows of the same note |
| `note_text` | TEXT | Full note text with @mentions |
| `details` | TEXT | Extra details (legacy single-tag mode) |
| `school_year` | TEXT NOT NULL | School year |
| `created_at` | DATETIME | Creation timestamp |

**Unique constraint:** `(tag_date, entity_type, entity_name, tag_key, school_year)`

### Tag Types — Single Source of Truth

**File:** `js/data/system-tag-types.js` (global `ALL_TAG_TYPES` array)

Always import this file in any page that needs tag type definitions. **Never** define tag types inline.

Available keys: `educational_activity`, `meeting`, `competition`, `training`, `inspection`, `field_trip`, `early_release`, `short_session`, `cancelled_session`, `cultural_activity`, `sports_activity`, `disciplinary_council`, `other`

### IPC Channels

| Channel | Auth | Purpose |
|---------|------|---------|
| `systemTags:getByDate` | `handleRead` | Fetch tags by date + schoolYear |
| `systemTags:save` | `handleWriteSoftAuth(admin,staff)` | Insert/update single tag |
| `systemTags:saveNote` | `handleWriteSoftAuth(admin,staff)` | Save note with @mentions (creates note_group UUID, one row per mention) |
| `systemTags:delete` | `handleWriteSoftAuth(admin,staff)` | Delete single tag by ID |
| `systemTags:deleteByGroup` | `handleWriteSoftAuth(admin,staff)` | Delete all rows sharing a note_group |

### Preload API: `window.api.systemTags`

```js
window.api.systemTags.getByDate(date, schoolYear)
window.api.systemTags.save(payload)
window.api.systemTags.saveNote({ tag_date, tag_key, tag_label, note_text, mentions: [{type, id, name}], school_year })
window.api.systemTags.delete(id)
window.api.systemTags.deleteByGroup(noteGroup)
```

### Sync Capture (capture.js)

All systemTags channels are registered in `CHANNEL_REGISTRY` for sync outbox capture.

### Files Involved

- **DB schema:** `main/db/migrations.js` (migrations `2026-04-045-system-tags`, `2026-04-046-system-tags-notes`)
- **IPC handlers:** `main/ipc/staff.js` (section: System Tags CRUD)
- **Preload:** `preload.js` (`systemTags` namespace)
- **Sync capture:** `main/sync/capture.js` (4 channel entries)
- **Tag types:** `js/data/system-tag-types.js` (centralized `ALL_TAG_TYPES`)
- **Frontend:** `staff-daily-report.html` (note form, @mention autocomplete, tags table)
- **Plan doc:** `docs/plans/2026-04-10-system-tags.md`

<!-- MANUAL ADDITIONS END -->


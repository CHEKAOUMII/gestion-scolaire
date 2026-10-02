# Import Center — Migration Notes

**Feature:** `smart-central-import-center`  
**Status through Package 7**

## What migrated

| Path | Before | After |
|---|---|---|
| Multi-file drop on `settings-imports.html` | `initDropZone` → one batch-wide `inferImportActionFromFiles` → confirm → `handleImport` | `initSmartImportCenter` → per-file classify + preflight → review → confirm → orchestrator |
| Contextual entry | N/A or plain page link | `settings-imports.html?type=&year=&source=` hints only |
| Absence apply | `deleteByYear` + `saveBulk` (two IPC) | Prefer `absences:replaceByYear` (one transaction) |
| Post-import | Manual paths only | Smart batch also uses compact log + readiness + post-import validator |

## Compatibility wrappers retained

These remain callable and are still used by manual accordion cards and keyboard shortcuts:

- `runImport`
- `handleImport`
- `importStudents` / `importGrades` / `importAbsences` / `importFetXml` / `importAgentXml` / `importStudentStatus`
- Hidden inputs: `students-file-input`, `grades-file-input`, `absences-file-input`, `fet-file-input`, `status-file-input`, `agent-xml-file-input`

`inferImportActionFromFiles` is retained as a **low-weight filename hint** for the classifier only.

## Removed (proven duplicate)

| Symbol | Reason |
|---|---|
| `initDropZone` (settings-imports.js) | Dead after smart drop wiring; re-binding would double-handle drop and reintroduce silent batch import |

No broad rewrite of `js/pages/settings-imports.js` was performed. Manual importers remain page-local.

## CSS

- Edit only `css/tailwind-input.css`
- Generated `css/tailwind-output.css` via `npm run css:build`

## Not migrated (still manual / deferred)

- Full adapter `execute` calling production importers for every type (smart path still uses guarded `executeImpl` / prepared counts where wired)
- Cross-type distributed transaction
- Durable import Jobs (see `persistence-decision.md`)

# Bugfix Requirements Document

## Introduction

When sync runs on a device that started from a shared database backup/seed, the first push produces a flood of "unresolved" conflicts that surface on the settings-sync page, most visibly for the `compensation_tracking`, `settings`, and `system_tags` tables. These conflicts are phantom: there is no genuine difference between what two devices intend to store. They occur because rows that were never reconciled against the server are pushed with `version=1` while the matching server document already holds `version=1` (written by another device from the same seed). The version guard treats `1 >= 1` as a conflict, and because no ancestor data exists the three-way merge cannot resolve cleanly and falls back to an unresolved last-writer-wins outcome. The remote copy is often weeks old, so equivalence detection also fails and the conflict is never auto-resolved. The result is a persistent, growing list of conflicts that require no real human decision, undermining trust in the sync status surface and burying any genuine conflicts.

## Bug Analysis

### Current Behavior (Defect)

These clauses describe what the system does today when a device pushes shared/seeded rows that it has never reconciled against the server.

1.1 WHEN a row has no reconciled version locally (`sync_id_map.version` is missing or 0) AND a matching document already exists on the server with the same effective version THEN the system records an unresolved version conflict instead of reconciling the row.

1.2 WHEN a version conflict is detected for a row that has no local ancestor data (`ancestor_data` is null) THEN the system runs the three-way merge without an ancestor, falls back to unresolved last-writer-wins, and logs the conflict as unresolved.

1.3 WHEN the first push of shared/seeded data occurs across the affected tables (`compensation_tracking`, `settings`, `system_tags`, and other tables sharing a deterministic document id) THEN the system generates a flood of unresolved conflicts even though no device made a genuine field-level change.

1.4 WHEN the server copy of a never-reconciled row is stale (significantly older than the local copy) and not byte-equivalent THEN the system fails to auto-resolve the conflict and leaves it unresolved indefinitely.

### Expected Behavior (Correct)

These clauses describe the corrected behavior for the same conditions.

2.1 WHEN a row has no reconciled version locally (`sync_id_map.version` is missing or 0) AND a matching document already exists on the server THEN the system SHALL reconcile the row by adopting the server version into the local version tracking and setting the local ancestor data to the server data, rather than recording an unresolved conflict.

2.2 WHEN a version conflict is detected for a row that has no local ancestor data THEN the system SHALL adopt the server data as the ancestor, re-run the three-way merge with that ancestor, and re-push with the correct (incremented) version only if a genuine local change remains.

2.3 WHEN the first push of shared/seeded data occurs across the affected tables and no device made a genuine field-level change THEN the system SHALL complete reconciliation without generating any unresolved conflicts.

2.4 WHEN rows already exist both locally and on the server but the local version tracking is unreconciled THEN the system SHALL provide a mechanism to reconcile `sync_id_map` (version and ancestor data) so subsequent pushes use the correct version.

2.5 WHEN reconciliation completes for a previously unreconciled row THEN the system SHALL generate an unresolved conflict only if there is a real field-level difference between devices after an ancestor is available.

### Unchanged Behavior (Regression Prevention)

These clauses describe behavior that must be preserved by the fix.

3.1 WHEN two devices make genuine concurrent edits to different fields of the same row and an ancestor is available THEN the system SHALL CONTINUE TO merge the non-overlapping changes cleanly.

3.2 WHEN two devices make genuine concurrent edits to the same field of the same row THEN the system SHALL CONTINUE TO resolve via the existing last-writer-wins path and record a real conflict where applicable.

3.3 WHEN a pushed row's version is genuinely behind the server version due to a real concurrent update THEN the system SHALL CONTINUE TO apply the version guard and treat it as a conflict rather than silently overwriting.

3.4 WHEN local and remote data for a conflicting row are byte-equivalent THEN the system SHALL CONTINUE TO auto-resolve the conflict as already handled today.

3.5 WHEN a row has a properly reconciled version and ancestor data THEN the system SHALL CONTINUE TO push, version, and log changes exactly as it does today.

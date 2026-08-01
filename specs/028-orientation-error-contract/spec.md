# Feature Specification: Orientation Error Contract (Hybrid Handling)

**Feature Branch**: `028-orientation-error-contract`  
**Created**: 2026-07-17  
**Status**: Draft  
**Input**: User description: "docs/plans/2026-07-17-centralized-error-handling-plan.md — hybrid error-handling for student orientation: one shared error vocabulary (codes, safe default Arabic messages, severity, retryability, safe-detail rules, normalization) with page-local recovery UX; remove three competing catalogs without a global error handler"

**Source plan**: `docs/plans/2026-07-17-centralized-error-handling-plan.md`

**Related (complementary, not in scope)**: `docs/plans/2026-07-17-centralize-error-handling-plan.md` (app-wide renderer reaction helper for any IPC result). This feature defines *what an orientation error means*; that sibling defines *how pages react* to results. They compose; neither supersedes the other.

## Clarifications

### Session 2026-07-17

- Q: Where should page-only orientation failure codes live? → A: One vocabulary with two sections (shared + page-only); service boundary uses shared section only
- Q: When a page shows a shared orientation failure, may it change the default Arabic text? → A: Core fixed, context allowed — vocabulary owns stable meaning/default; pages may add presentation context without redefining the failure
- Q: If some import batches committed and a later batch fails, what overall outcome does the user see? → A: Partial progress + failed batch — accurate counts for committed batches; failed batch reported as rolled back / not saved
- Q: When a stale load response is discarded after a rapid school-year switch, should the user see a notice? → A: Silent discard — no toast/status spam; keep content for current selection only
- Q: When display gets a wrong-year response (YEAR_RESPONSE_MISMATCH), how is the user informed? → A: Visible non-blocking notice (toast and/or status); not empty success; not full-page hard error; distinct from silent stale discard

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import failures stay accurate and actionable (Priority: P1)

A school staff member imports student-orientation data for the selected school year. When something goes wrong—unreadable file, invalid structure, missing required fields, wrong school year in the file, or a storage/sync failure after the system already started writing—they see a clear Arabic explanation of what happened and what to do next. They are never told that a failed import “partially saved” rows that were actually rolled back, and a normal import never wipes the year’s existing orientation data as a shortcut.

**Why this priority**: Incorrect import feedback can cause re-import chaos, lost trust in the data, or accidental mass deletion. Safe, consistent failure meaning is the core product risk this feature addresses.

**Independent Test**: Attempt imports with deliberately bad files (empty, unsupported format, missing student code, year mismatch) and a simulated storage/transaction failure; confirm each case yields the correct user-facing outcome, summary counts on success, and no false partial-success after rollback—without requiring display-page changes.

**Acceptance Scenarios**:

1. **Given** a readable orientation file with valid rows for the selected school year, **When** the staff member completes import, **Then** they see an Arabic summary of inserted, updated, unchanged, skipped, and in-file duplicate counts, and existing year data is not cleared as part of the normal path.
2. **Given** an unreadable, empty, unsupported, or structurally invalid file, **When** the staff member tries to import, **Then** they receive a clear local failure message and no orientation records are written for that attempt.
3. **Given** a file whose school year does not match the selected year, **When** the staff member tries to import, **Then** import is blocked before write with a clear year-mismatch message (no silent year substitution).
4. **Given** a storage or transaction failure during batch import after some work may have started, **When** the failure is reported, **Then** the user is told the failed batch was rolled back (or equivalent retry-safe failure), not that that batch’s rows permanently committed; retry remains safe and does not create duplicate orientation rows for the same student and year.
5. **Given** earlier import batches already committed successfully and a later batch fails, **When** the run finishes, **Then** the user sees accurate summary counts for the committed batches **and** a separate clear failure for the failed batch (partial progress + failed batch)—not a single “whole import failed” that hides prior success, and not rollback wording that falsely implies earlier batches were undone.
6. **Given** rows that fail validation or are skipped while other rows succeed in a non-error outcome path, **When** the import completes successfully, **Then** the summary distinguishes accepted vs skipped/rejected outcomes without presenting a system failure.

---

### User Story 2 - Orientation display recovers partially without wiping good data (Priority: P1)

A counselor or administrator opens the orientation board for a school year. If the list loads but statistics fail, or charts fail while tables and KPIs succeed, usable content remains on screen. If they switch school year quickly while an older request is still in flight, the older response must not overwrite the newer year’s content. A legitimate empty result (no matching students) must not look like a load failure.

**Why this priority**: Orientation is used during live decision work; a total-page failure for a partial fault wastes time and erodes trust. Stale overwrite is a silent data-integrity UX bug.

**Independent Test**: Force list-only failure, stats-only failure, chart-only failure, rapid year switch during load, and a valid zero-result filter; verify independent recovery and no stale overwrite—without requiring import changes.

**Acceptance Scenarios**:

1. **Given** orientation list data loads successfully and statistics fail, **When** the page finishes handling both responses, **Then** the table (or list content) remains visible and the user is informed that statistics could not load, with a path to retry stats without losing list data.
2. **Given** list and stats loaded successfully and only chart rendering fails, **When** the failure is handled, **Then** KPIs and tables remain usable and a non-destructive chart failure notice appears (charts do not remove already-loaded content).
3. **Given** the user selects year A then quickly selects year B while year A’s responses are still in flight, **When** year A’s responses arrive after year B is selected, **Then** year A’s data is discarded silently (no toast or status spam for ordinary stale discard) and does not replace year B’s UI state.
4. **Given** a response whose school year does not match the requested year, **When** the page evaluates the response, **Then** it is treated as a consistency failure (not as “no students”), is not rendered as a valid empty board, does not overwrite current content with wrong-year data, and the user sees a **visible non-blocking notice** (toast and/or status)—not a full-page hard error and not a silent discard.
5. **Given** a successful load with zero matching orientation rows for a valid filter/year, **When** results are shown, **Then** the page presents a legitimate empty state, not a load-error state.

---

### User Story 3 - Same error means the same thing everywhere in orientation (Priority: P1)

Product engineers and support staff can trust that a given orientation error code (for example “import rolled back,” “invalid school year,” “could not load list”) has one stable meaning, default Arabic wording, severity, and retry expectation whether the failure is produced by the import page, the display page, or the server-side orientation operations. Competing catalogs no longer redefine the same code with different wording or semantics.

**Why this priority**: Catalog drift is the root defect named in the source plan; without a single vocabulary, testing, support, and UI branching diverge over time.

**Independent Test**: Enumerate all shared orientation failure codes; confirm one authoritative definition each (default message, severity, retryability); confirm import and display consumers no longer maintain competing definitions for those shared codes; confirm page-only codes (file parse vs display-only) remain clearly separated.

**Acceptance Scenarios**:

1. **Given** a shared orientation failure code, **When** it is raised from the orientation service boundary or from a page that reuses the shared vocabulary, **Then** severity class, retryability, and the stable failure meaning match the single contract definition; the vocabulary default Arabic message is the baseline, and any page-added presentation context must not reframe it as a different kind of failure.
2. **Given** the import page and the display page, **When** catalogs for shared codes are inspected after this feature, **Then** neither page maintains a full competing catalog for those shared codes.
3. **Given** an unknown or unexpected failure code, **When** it is normalized for display or logging, **Then** the user sees a generic safe infrastructure message—not the raw unknown code or internal text.
4. **Given** page-only situations (local file read/parse on import; stale response or chart failure on display), **When** those failures occur, **Then** they are expressed via the vocabulary’s page-only section (not ad-hoc per-page catalogs), remain unused by the service boundary, and do not redefine a shared code’s meaning.

---

### User Story 4 - Failures stay private and safe for school data (Priority: P2)

When orientation import or display fails, staff never see raw database errors, SQL, stack traces, absolute file paths, credentials, full file contents, or unbounded dumps of student rows in the UI. Operators reviewing diagnostic logs can still see structured, sanitized facts (code, channel, safe year/role, category, retryability, bounded counts) sufficient to diagnose without logging full PII or secrets.

**Why this priority**: School systems handle student data; leakage of internals or PII in errors is a security and trust failure even when the feature “works.”

**Independent Test**: Force an internal storage-style failure and a validation failure; inspect user-visible text and log records for absence of forbidden detail classes and presence of allowed bounded metadata.

**Acceptance Scenarios**:

1. **Given** an internal storage or unexpected system failure on an orientation operation, **When** the result reaches the user interface, **Then** the message is plain-language Arabic (or an existing safe default) with no SQL, stack, path, or driver text.
2. **Given** a validation or row-level rejection with details, **When** details are shown or logged, **Then** only allowlisted fields appear (e.g. school year, field name from allowlist, row/count metrics, operation name, bounded skip-reason list)—never full file contents or unbounded rejected-row arrays with sensitive payload.
3. **Given** a failure at the orientation service boundary, **When** diagnostics are recorded, **Then** logs include stable code and safe context and exclude tokens, license material, full student payloads, and raw exception dumps intended only for developers.

---

### User Story 5 - Contributors can extend orientation errors without reintroducing drift (Priority: P3)

A contributor adding or adjusting an orientation failure can find a single place that owns stable codes and default metadata, understands that page recovery stays local, and knows this pattern is orientation-first (not an app-wide global error screen). Existing externally observed codes remain compatible (or explicitly aliased and tested)—especially import-rollback—so logs and UI branches do not silently break.

**Why this priority**: Prevents the three-catalog problem from returning after the first cleanup.

**Independent Test**: Review contributor-facing notes and the contract inventory; attempt to map a new shared code vs a page-only code; run automated checks that prove unknown codes fall back safely and locked codes remain recognized.

**Acceptance Scenarios**:

1. **Given** a contributor needs a new *shared* orientation failure meaning, **When** they follow project guidance for this feature, **Then** they add it once to the shared vocabulary rather than copying a catalog into both pages and the service boundary.
2. **Given** existing production/test-observed codes (including import rollback and all codes that currently cross the orientation service boundary), **When** the feature ships, **Then** those codes remain recognized with compatible meaning (or documented aliases with tests).
3. **Given** the sibling app-wide “how to react to any IPC result” helper work, **When** both exist, **Then** orientation failures can be normalized by this contract first so reaction helpers consume a stable shape—without requiring that sibling work to land in this feature.

---

### Edge Cases

- **Nothing valid to write after local validation**: Outcome is a validation/summary path, not a storage outage; user is not told the database failed.
- **All rows pre-skipped at the service boundary**: Success-with-skips (or equivalent non-error outcome already established), not a top-level domain error that implies transaction failure.
- **Partial batches already written client-side then a later batch fails**: User sees **partial progress + failed batch**: accurate counts for committed batches; failed batch reported as rolled back / not saved. Messaging must not claim the failed batch’s rows committed; must not imply earlier successful batches were undone; must not collapse the run into a single whole-import failure that hides prior success.
- **Auth or role failure on write**: User sees authentication/authorization failure (lean safe outcome), not an orientation domain code that pretends to be a data validation issue.
- **Rapid year switch clearing loading state incorrectly**: An older response must not clear the newer request’s loading indicator or leave the UI stuck in “loading” forever.
- **Retry after import rollback**: Second attempt uses the same non-destructive merge rules; no duplicate orientation records for the same student code and school year.
- **Clear-year destructive path**: Remains separate, confirmed, shows target year, refreshes only on success; never used as the normal import mechanism.
- **Unknown code from a future peer or outdated client**: Normalize to generic safe failure; never render the raw code string as the primary user message.
- **Display-only stale discard**: Always silent discard for ordinary superseded loads (rapid year switch / older generation)—no toast and no status-line spam; do not treat as “empty year.”
- **Wrong-year response (consistency failure)**: Distinct from stale discard. Reject wrong-year payload, do not render as empty success, do not overwrite current content; show a visible non-blocking notice (toast and/or status). Do not force a full-page hard error that wipes usable content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST maintain a single shared orientation error vocabulary that defines, for each stable code: default safe Arabic message, severity (informational / warning / error), whether the failure is retryable, classification (e.g. validation, domain, infrastructure, transport, display), and whether row-level details are expected.
- **FR-002**: The orientation import page, orientation display page, and orientation service boundary MUST consume that shared vocabulary for all *shared* codes and MUST NOT maintain competing catalogs that redefine those codes’ meaning, severity, retryability, or security classification.
- **FR-002a**: For shared codes, the vocabulary default Arabic message is the authoritative baseline. Pages MAY append or frame **presentation context** (step name, counts, retry hint) but MUST NOT replace the stable core meaning with a different failure narrative or a competing full message catalog entry.
- **FR-003**: Page-local failure kinds that never leave the page (file/read/parse on import; stale-response, wrong-year consistency, chart isolation on display) MUST live in a clearly separated **page-only** section of the same shared orientation error vocabulary (not as competing per-page catalogs). The service boundary MUST consume only the **shared** section and MUST NOT require page-only codes. Page-only codes MUST NOT collide with shared code meanings.
- **FR-004**: Orientation failure responses presented to pages MUST remain in the existing flat success/failure form (failure includes at least success flag, code, and user-facing error text; rich domain failures may also include message, details, and retryable). The feature MUST NOT introduce a nested “error object only” shape that breaks existing page consumers.
- **FR-005**: Normalization MUST accept both lean failures (e.g. auth/internal) and rich domain failures and produce a predictable superset (fill missing message from error text; default retryable/severity from the vocabulary; details null when absent).
- **FR-006**: Unknown codes MUST normalize to a generic safe infrastructure failure; raw unknown codes and internal exception text MUST NOT be shown as primary user messages.
- **FR-007**: The service boundary MUST continue to strip unsafe details before any orientation failure is returned to the UI: no raw exception text, stacks, SQL, filesystem paths, credentials, full file contents, or unbounded sensitive row dumps.
- **FR-008**: Safe detail allowlist for orientation failures MAY include selected school year, allowlisted field names, row/count metrics, duplicate counts, accepted/rejected/skipped counts, retry hints, operation name, and a bounded skip-reason list; all other detail classes MUST be rejected or stripped.
- **FR-009**: Import MUST keep hard school-year match against the selected year (no silent substitution), local structural/row validation before write, in-file dedupe behavior and duplicate counting, batch import with accurate success summary, and the established distinction between validation failures and import rollback.
- **FR-010**: Normal import MUST NOT clear all orientation data for the year as a preparation step; clear-year remains a separate, explicit, confirmed destructive action.
- **FR-011**: A failed transactional import batch MUST NOT be presented as permanent partial commit of that batch; rollback (or equivalent) messaging and retry safety MUST be preserved. Merge identity remains student code + school year with non-destructive update rules already established for the product.
- **FR-011a**: When import is sent as multiple batches and some batches commit before a later batch fails, the user-facing outcome MUST report **partial progress + failed batch**: accurate success summary for committed batches plus a clear failure for the failed batch. The product MUST NOT (a) hide prior committed progress behind a single whole-import failure, or (b) use whole-run rollback language that implies earlier successful batches were undone.
- **FR-012**: Display MUST keep independent handling of list vs statistics failures, isolated chart failure that does not remove tables/KPIs, generation/token-based stale response discard, and rejection of wrong-year responses as consistency failures rather than empty data.
- **FR-012a**: Ordinary stale responses (older generation after the user changed selection) MUST be discarded **silently**—no toast and no status-line spam. Silent stale discard MUST NOT be confused with wrong-year consistency failures.
- **FR-012b**: When a response’s school year does not match the requested year, the page MUST treat it as a consistency failure: MUST NOT render it as a valid empty board, MUST NOT apply wrong-year data over current content, MUST show a **visible non-blocking notice** (toast and/or status), and MUST NOT require a full-page hard-error replacement of the board.
- **FR-013**: Existing codes that currently cross the orientation service boundary, plus import-rollback and other externally observed shared codes, MUST remain compatible or be aliased with tests—no silent renames.
- **FR-014**: Main-boundary diagnostic logging for orientation failures MUST record stable code and safe context (channel, sanitized role/year, category, retryability, bounded counts) and MUST NOT log full files, tokens, license secrets, raw SQL, or full student PII dumps.
- **FR-015**: This feature MUST NOT introduce a single global error screen or a global handler that replaces page-specific recovery, loading state, summaries, or empty states.
- **FR-016**: Scope is the orientation domain (import + display + orientation service boundary). Generalizing the same contract pattern to other domains is optional guidance only and out of scope for delivery of this feature.
- **FR-017**: No database schema migration is required solely for this architecture.
- **FR-018**: Existing authorization rules for orientation reads/writes (including soft-auth bulk import where already allowed, hard auth for destructive clear, role restrictions excluding pure viewers on writes) MUST remain unchanged in user-visible effect.
- **FR-019**: Automated verification MUST cover: vocabulary completeness (message, severity, retryable per code); unknown-code fallback; safe-detail stripping vs allowlist; recognition of locked shared codes; normalization of both lean and rich failure shapes; import rollback vs validation distinction; display stale/wrong-year discard; isolated chart failure. Checks MUST run without requiring a full desktop UI session where the project already uses headless/unit style for orientation.
- **FR-020**: Duplicate internal-message sanitization logic specialized only for orientation SHOULD be removed in favor of one shared sanitization path at the service boundary, without weakening current sanitization quality.

### Key Entities

- **Shared orientation error vocabulary (contract)**: Single source of stable codes and default metadata (message, severity, retryability, classification, detail expectations) plus pure normalization/fallback rules usable by both the service boundary and school UI pages.
- **Shared failure code**: Identifier with one meaning across import, display, and service boundary (examples of categories: invalid school year, invalid record, database failure, import rollback, list/stats load failure, sync registration failure).
- **Page-only failure code**: Identifier defined in the vocabulary’s page-only section and consumed entirely in the UI (file/parse issues; stale response; chart render failure; year-response mismatch on display); never required by the service boundary and never crosses the service bridge as a service-owned code.
- **Lean failure outcome**: Minimal failure form (success false, code, safe error text)—typical of auth or generic internal failures.
- **Rich domain failure outcome**: Extended failure form (also message, optional details, retryable)—typical of orientation domain mapping.
- **Safe detail payload**: Bounded, allowlisted structured context attached to a failure (counts, year, field names, operation name)—never full sensitive payloads.
- **Import summary**: User-facing counts after import (inserted/updated/unchanged/skipped/duplicates) distinct from failure outcomes.
- **Stale response**: Result of an older load request that must be discarded after a newer school-year selection or generation token.
- **Import rollback**: Compatibility-locked failure meaning that a transactional import unit of work did not permanently apply; retry is expected to be safe under existing merge rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of shared orientation failure codes used by import, display, and the orientation service boundary resolve to a single vocabulary definition (one default message, severity, and retryability each)—verified by inventory check with zero competing definitions for those codes. Spot-checks of user-visible text confirm presentation context does not reframe a shared code as a different failure type.
- **SC-002**: In a scripted suite of import failure cases (unreadable/empty/unsupported/malformed/missing field/invalid numeric/year mismatch/rollback), 100% produce an actionable Arabic outcome and 0% present a rolled-back batch as permanently partially saved. When a multi-batch run has prior commits then a failed batch, verification confirms committed counts remain accurate and the failed batch is not described as saved or as undoing prior batches.
- **SC-003**: In a scripted suite of display failure cases (list-only fail, stats-only fail, chart-only fail, stale generation, wrong-year response, valid empty result), 100% preserve independent recovery rules and 0% allow a stale or wrong-year response to overwrite the current selection’s content. Stale discard produces no user-facing spam; wrong-year produces a visible non-blocking notice and is never shown as empty success.
- **SC-004**: Forced internal/storage-style failures show 0 occurrences of SQL, stack traces, absolute paths, or driver text in user-visible orientation messages during verification.
- **SC-005**: Automated contract tests pass for every vocabulary code’s required metadata, unknown-code fallback, allowlisted vs stripped details, locked code recognition, and both lean and rich failure normalization—without launching the full desktop UI.
- **SC-006**: Normal successful import path performs 0 clear-year operations; destructive clear-year remains a separate confirmed action in manual or automated checks.
- **SC-007**: Existing smoke/parity and orientation-targeted automated suites remain green after integration; no intentional change to school-facing happy-path import or display results for valid data.
- **SC-008**: A reviewer can confirm within five minutes that the import page, display page, and orientation service boundary no longer each own a competing full catalog; one vocabulary holds shared and page-only sections, and the service boundary does not depend on page-only codes.

## Assumptions

- End-user happy paths for orientation import and display remain behaviorally the same; this feature primarily removes catalog drift and hardens consistent failure meaning.
- Default Arabic wording is unified to the shared vocabulary’s defaults where pages currently disagree. Pages may add presentation context around that default but must not ship a second full wording that redefines the failure (core fixed, context allowed).
- Codes that today never leave the renderer are classified as page-only in the same vocabulary (separate section) unless a future requirement promotes them to the shared section; `SCHOOL_YEAR_MISMATCH` as a hard import stop remains page-enforced, while per-row year issues may continue to appear as row-level skip reasons rather than a top-level service error when that is already product behavior.
- Page-only codes are not maintained as independent catalogs inside import or display page scripts.
- The sibling renderer “IPC result reaction helper” plan is complementary and not required to complete this feature; sequencing recommendation is vocabulary first, then reaction helper consumers.
- Authorization model, sync capture mode for orientation bulk/clear/delete, and non-destructive merge semantics are preserved, not redesigned.
- No new school-year formats or orientation data fields are introduced by this work.
- “Hybrid” means centralized vocabulary + local recovery—not a single global error UI.

## Out of Scope

- App-wide global error boundary or toast flood control (already covered by other features).
- App-wide `ipc-result` / “how every page reacts to any IPC result” helper (sibling plan).
- Replacing page-local validation, batching, summaries, `loadGeneration`/stale discard, or chart isolation with a central UI controller.
- Renaming or redesigning orientation data model / database schema.
- Migrating all other product domains onto the same contract in this delivery.
- Changing preload channel names or adding new orientation business operations.
- Introducing nested error response envelopes.
- Using clear-year as an import strategy.
- Changing Arabic product language to another language.
- Redesigning sync transport or capture modes for orientation.

## Dependencies

- Existing orientation import and display pages and orientation service operations remain the integration surface.
- Existing unified message system (confirmations/toasts) continues to present user-facing notices; this feature does not replace it.
- Project layering rules: service boundary does auth + validation + mapping; data access owns persistence and transactional bulk write; pages own interaction state.
- Sibling plan for app-wide result reaction helpers may later consume this vocabulary’s normalization for orientation channels.

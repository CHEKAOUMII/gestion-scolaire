# Research: Phase 7.6 IPC Layer

## Decision 1: Use `linking` as the canonical IPC domain and keep `setup` as a preload compatibility alias

- **Decision**: Add a canonical `window.api.linking` namespace backed by canonical `linking:*` IPC channels, and keep `window.api.setup` as a temporary preload-only alias for the four first-run methods already used by `js/pages/setup.js`.
- **Rationale**: The runtime app currently calls only the `setup` namespace from the first-run page, but the Phase 7.6 design expands the surface to OTP and linked-device management. A preload-only alias preserves the live onboarding flow while letting the main-process contract converge on the broader linking domain without duplicated IPC handlers or sync-capture registry entries.
- **Alternatives considered**:
    - Replace `setup` immediately: clean end state, but risks breaking the current setup page unless every renderer call site changes at the same time.
    - Keep `setup` forever: lowest short-term churn, but it poorly fits ongoing device-management actions.
    - Register both `setup:*` and `linking:*` handlers: workable, but duplicates handler bookkeeping and expands the smoke-tested contract surface.

## Decision 2: Keep all new handlers inside the repository's wrapper-based IPC architecture

- **Decision**: Use `handleRead` for pre-login reads, `handleWriteSoftAuth(..., [], ...)` for pre-login writes, and `handleWrite(..., ['admin'], ...)` for admin-only device-management actions.
- **Rationale**: This matches the repository's current setup handler pattern, respects the constitution's ban on raw handlers for new work, and keeps session enforcement consistent with the existing sender-scoped in-memory session model.
- **Alternatives considered**:
    - Raw `ipcMain.handle()`: rejected because the constitution prohibits it for new IPC work even though older modules still contain legacy raw handlers.
    - `handleWriteNoAuth`: rejected because the current repository does not use it and the smoke suite explicitly guards against that pattern.
    - A custom admin-read wrapper: unnecessary for this feature because read-like admin channels can use `handleWrite` plus sync-capture exclusion.

## Decision 3: Standardize the IPC contract around normalized DTOs and machine-readable error codes

- **Decision**: Define the linking IPC contract around a small set of normalized DTO families: institution status, new-institution setup input, link-verification input/result, OTP session status, linked-device summary, and current-device summary. All failure results will use `{ success: false, code, error }` with stable codes such as `ALREADY_CONFIGURED`, `INVALID_MASSAR`, `INVALID_OTP`, `OTP_EXPIRED`, `RATE_LIMITED`, `FORBIDDEN`, and `CURRENT_DEVICE_PROTECTED`.
- **Rationale**: The repository already has inconsistent validation rules between `main/ipc/setup.js` and `main/linking/otp.js`, and the current setup flow mostly returns localized free-form errors. Normalized DTOs and stable codes make the renderer, smoke verification, and future settings UI more predictable.
- **Alternatives considered**:
    - Expose helper outputs as-is: fastest, but preserves validation drift and transport-specific shapes.
    - Keep free-form error strings only: simple for one page, but fragile for future device-management UI and automated verification.
    - Split contract rules across each helper: rejected because validation differences already caused drift.

## Decision 4: Carry bootstrap sync metadata through linking without folding licensing into the linking domain

- **Decision**: The link-success payload will carry institution and sync bootstrap metadata, including MASSAR/school ID, lambda URL, region, interval, enabled flag, and `licenseKey` pass-through, but the IPC layer will not directly assume responsibility for license activation workflows.
- **Rationale**: The phase plan expects linked devices to receive institution settings needed to finish setup, and a future phase explicitly calls for license key bootstrap. At the same time, active license state is still owned by the licensing domain, so Phase 7.6 should expose the data needed for downstream integration without merging two domains into one contract.
- **Alternatives considered**:
    - Omit `licenseKey` from bootstrap payloads: simpler now, but it conflicts with the phase roadmap and leaves linked devices short on sync-related metadata.
    - Make linking IPC activate licenses directly: rejected because it mixes distinct security and lifecycle responsibilities.
    - Keep sync bootstrap limited to the existing LAN payload fields: rejected because that preserves the current bootstrap gap instead of designing the contract needed by later phases.

## Decision 5: Adopt constitution-compliant kebab-case channel strings under camelCase renderer methods

- **Decision**: Canonical IPC channels will use domain-prefixed kebab-case strings such as `linking:get-institution-status`, while preload method names remain camelCase such as `window.api.linking.getInstitutionStatus()`.
- **Rationale**: This satisfies the constitution's channel naming rule without forcing renderer consumers into awkward method names and keeps the migration isolated to preload, registration, and tests.
- **Alternatives considered**:
    - Keep camelCase channel strings for consistency with older modules: simplest migration, but it repeats an existing constitution mismatch.
    - Rename renderer methods to kebab-case equivalents: rejected because JavaScript object APIs are clearer in camelCase and the constitution speaks to channel naming, not method naming.

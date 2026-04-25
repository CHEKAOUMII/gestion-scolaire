Product Requirements Document: Gestion Scolaire (برنامج التدبير المدرسي)

  Version: 1.0.3
  Date: 2026-02-22
  Status: Active / Post-Launch

  ---
  1. Product Overview

  Gestion Scolaire is a desktop application for Moroccan qualifying high schools
   (lycées qualifiants) that centralizes administrative operations — student
  records, grades, absences, teacher management, exam logistics, timetabling,
  and official document generation — into a single offline-first tool.

  It is built as an Electron app with a local SQLite database, targeting
  Windows. The UI is entirely in Arabic (RTL), using official Moroccan Ministry
  of Education terminology. There is no server dependency for core operations;
  the app runs fully offline with an optional telemetry sync to a lightweight
  Node.js server for fleet management.

  Core problems it solves:

  - Moroccan high school administrators currently juggle Excel spreadsheets, the
   national Massar platform, and paper records. This app consolidates those
  workflows into one local tool.
  - Exam proctoring, absence correspondence, and grade analysis are manual
  processes that this app partially automates.
  - There is no affordable, Arabic-language, offline-capable school management
  tool targeting this specific tier of the Moroccan education system.

  Target deployment: Individual high schools. The named reference customer is
  "الثانوية التأهيلية ابن سينا" (Ibn Sina Qualifying High School), though the
  product is designed for any Moroccan lycée qualifiant.

  ---
  2. User Personas & Workflows

  Persona 1: School Administrator (المدير / الحارس العام)

  Role: Primary user. Manages the entire school's data.

  Key workflows:
  - Start of year: Import student lists and teacher rosters from Excel (Massar
  export format). Import timetables from FET XML. Set current school year.
  - Ongoing: Record student movements (transfers, arrivals, departures,
  dropouts). Track document submissions per student. Manage exam scheduling,
  room assignments, and proctor distribution.
  - Periodic: Generate absence correspondence letters for parents. Print grade
  sheets for teachers. Review absence and grade analytics. Generate school
  certificates.
  - End of semester: Run grade analysis (zero-grade students, per-teacher
  performance, section comparisons). Print semester reports.

  Access level: Admin — full access to all features including user management,
  licensing, and data deletion.

  Persona 2: Staff User (الموظف)

  Role: Data entry and day-to-day operations.

  Key workflows:
  - Record individual student absences and grades.
  - Add teacher absence records.
  - Generate and print documents (certificates, grade sheets, correspondence).
  - View analytics dashboards.

  Access level: Staff — can create and edit records but cannot manage users,
  delete teachers, generate license keys, or modify system settings.

  Persona 3: School Owner / Operator (مالك النظام)

  Role: IT administrator or school network operator who deploys the app across
  multiple schools.

  Key workflows:
  - Generate and distribute license keys for each school.
  - Monitor deployed installations via the telemetry dashboard (active devices,
  last seen, license status).
  - Manage device activations (revoke lost devices, reassign licenses).

  Access level: Uses the admin interface plus the telemetry server dashboard.

  ---
  3. Core Features & Functionality

  3.1 Student Management

  Feature: Student Registry
  What it does: CRUD operations on student records (code, name, birth date,
    gender, section, status). All scoped by school year.
  ────────────────────────────────────────
  Feature: Bulk Import
  What it does: Imports student lists from Excel with automatic header detection

    (Arabic/French/English aliases). Deduplicates by student code.
  ────────────────────────────────────────
  Feature: Search & Filter
  What it does: Search by name, code, or class. Paginated display (25/page) with

    column sorting.
  ────────────────────────────────────────
  Feature: Student Profile
  What it does: Modal view showing grades grouped by subject with KPIs (average,

    min/max, absence hours).
  ────────────────────────────────────────
  Feature: Document Tracking
  What it does: Checklist of required documents per student (birth certificate,
    photos, etc.) with present/absent status per document.
  ────────────────────────────────────────
  Feature: Student Movements
  What it does: Records transfers (internal section changes), arrivals,
    departures, and dropouts. Automatically updates student status and section
  on
     movement.

  3.2 Grade Management & Analysis

  Feature: Grade Storage
  What it does: Per-student, per-subject, per-semester grades with teacher
    attribution.
  ────────────────────────────────────────
  Feature: Bulk Grade Import
  What it does: Multi-sheet Excel parsing with subject inference from
    filename/sheet name, teacher extraction from header rows, semester
    auto-detection.
  ────────────────────────────────────────
  Feature: Grade Sheets
  What it does: Printable grading forms (select class + subject + semester →
    table with student rows and blank grade columns). Export to PDF.
  ────────────────────────────────────────
  Feature: Zero-Grade Analysis
  What it does: Identifies students with grade=0, cross-references with absences

    to distinguish absence-related zeros from academic struggles. Paginated with

    filters.
  ────────────────────────────────────────
  Feature: Results Analytics
  What it does: Per-section and per-teacher grade analysis.
  ────────────────────────────────────────
  Feature: Teacher Performance Dashboard
  What it does: Multi-dimensional analytics: pass rates, averages, medians,
    standard deviations. Rating system (Excellent/Good/Acceptable/Needs
  Support).
     Six chart types via Chart.js. CSV export.

  3.3 Absence Management

  Feature: Absence Records
  What it does: Per-student records with date, month, type
    (justified/unjustified), hours, days, reason.
  ────────────────────────────────────────
  Feature: Bulk Import
  What it does: Supports multiple Excel formats: Massar matrix (positional
    columns per month), header-based, justified/unjustified split columns.
  ────────────────────────────────────────
  Feature: Weekly Absence Sheet
  What it does: Weekly view of absences by class.
  ────────────────────────────────────────
  Feature: Absence Analytics
  What it does: Stats by section, by month, top absentees (top 10). Total hours
    aggregation.
  ────────────────────────────────────────
  Feature: Per-Student Summary
  What it does: Breakdown of justified vs. unjustified hours per student.
  ────────────────────────────────────────
  Feature: Parent Correspondence
  What it does: Generate warning letters for chronically absent students. Track
    which letters have been printed.

  3.4 Teacher Management

  Feature: Teacher Registry
  What it does: Name, subject, phone, email, active status. Scoped by school
    year.
  ────────────────────────────────────────
  Feature: Teacher Absences
  What it does: Date, reason, replacement teacher, justified flag.
  ────────────────────────────────────────
  Feature: Teacher Schedule
  What it does: View timetable (data imported from FET).
  ────────────────────────────────────────
  Feature: Performance Indicators
  What it does: Cross-referenced with grade data for per-teacher analytics (see
    3.2).

  3.5 Exam Center

  Feature: Exam Scheduling
  What it does: Create exams with title, section, subject, date, and time.
  ────────────────────────────────────────
  Feature: Room Management
  What it does: Catalog of exam rooms with capacity and equipment info.
  ────────────────────────────────────────
  Feature: Proctor Distribution
  What it does: Manual assignment or automatic round-robin generation across all

    exams for a year.
  ────────────────────────────────────────
  Feature: Test Management
  What it does: Track supervised tests (devoirs surveillés) with status
  lifecycle
    (planned → completed).

  3.6 Timetable

  Feature: FET XML Import
  What it does: Parses timetable exports from FET software. Stores
    teacher/subject/class/slot mappings in localStorage.
  ────────────────────────────────────────
  Feature: Timetable Views
  What it does: Three views: by teacher, by class, by room. Renders static HTML
    generated by FET.
  ────────────────────────────────────────
  Feature: DB-backed timetable queries
  What it does: IPC channels exist (timetable:getByTeacher, etc.) but return
    empty arrays — not yet implemented.

  Assumption: The timetable feature currently relies entirely on FET-generated
  static HTML files stored in a timetables/ directory. The database-backed
  timetable is stubbed but not functional.

  3.7 Reports & Documents

  Feature: School Certificates
  What it does: Generate certificates with student data (rendered client-side as

    HTML, printed via Electron).
  ────────────────────────────────────────
  Feature: Administrative Forms
  What it does: Templated official forms.
  ────────────────────────────────────────
  Feature: Semester Reports
  What it does: Summary statistics: total grades, average, student count.
  ────────────────────────────────────────
  Feature: Printing System
  What it does: Three print modes: native dialog, PDF export with save dialog,
    and hidden-window clean print (HTML content without chrome).

  3.8 Settings & Administration

  Feature: School Information
  What it does: School name, address, metadata configuration.
  ────────────────────────────────────────
  Feature: Data Import Hub
  What it does: Central import page for students, grades, absences (Excel), and
    timetables (FET XML). Supports drag-and-drop. Per-year data deletion with
    confirmation.
  ────────────────────────────────────────
  Feature: User Management
  What it does: Admin creates users with email/role. Auto-generates temporary
    password with forced change on first login. Three roles: admin, staff,
    viewer. Enable/disable accounts.
  ────────────────────────────────────────
  Feature: Page Visibility
  What it does: Admin can show/hide specific pages from the sidebar (used to
  gate
    prototype pages).
  ────────────────────────────────────────
  Feature: Activity Log
  What it does: Audit trail of system actions with entity references.
  ────────────────────────────────────────
  Feature: Backup & Restore
  What it does: Full backup: localStorage + Base64-encoded SQLite snapshot →
    single JSON file. Restore validates SQLite integrity before overwriting.
    Auto-backup scheduling (daily/weekly). Max 5 backups retained.
  ────────────────────────────────────────
  Feature: School Year Switching
  What it does: Prompt-based year change (format: YYYY/YYYY). All data queries
    re-scope to selected year.

  3.9 Licensing & Monetization

  Feature: Free Trial
  What it does: 6-month default (configurable: 1/3/6 months). Starts on first DB

    creation. When expired with no license, app enters limited mode.
  ────────────────────────────────────────
  Feature: License Plans
  What it does: Three tiers: Basic (1 device), Pro (3 devices), Business (10
    devices).
  ────────────────────────────────────────
  Feature: Offline Activation
  What it does: HMAC-SHA256 signed serial keys (GSLK-...). No internet required
    for activation. Optional device-lock binding.
  ────────────────────────────────────────
  Feature: Device Fingerprinting
  What it does: Weighted multi-signal hardware fingerprint (CPU, BIOS serial,
  MAC
    addresses, memory, etc.). Fuzzy matching at 70% threshold tolerates OS
    reinstalls.
  ────────────────────────────────────────
  Feature: Device Management
  What it does: List activated devices, deactivate current device, admin revoke
    any device.
  ────────────────────────────────────────
  Feature: Limited Mode
  What it does: Without a valid license or trial, only dashboard, student list,
    and data import are accessible.
  ────────────────────────────────────────
  Feature: Grace Period
  What it does: 14-day offline grace for licenses requiring online validation.
    Warnings at ≤3 days remaining.

  3.10 Fleet Management (Owner Telemetry)

  Feature: Telemetry Sync
  What it does: Background heartbeats from each installation to a central server

    (Railway-hosted). Outbox queue pattern — works offline, flushes when
    connected.
  ────────────────────────────────────────
  Feature: Remote Dashboard
  What it does: Overview: total devices, activated count, active in 24h,
    breakdown by plan. Device list with last-seen timestamps.
  ────────────────────────────────────────
  Feature: Dual Tokens
  What it does: Separate write (device → server) and read (admin dashboard →
    server) authentication tokens.

  3.11 Auto-Update

  Feature: GitHub Releases
  What it does: electron-updater checks GitHub Releases (repo:
    CHEKAOUMII/project6.2). Manual download trigger, auto-install on next quit.
    Status events streamed to renderer UI. Requires GH_TOKEN.

  ---
  4. Technical Constraints & Dependencies

  Constraint: Platform
  Detail: Windows only. Build target is NSIS installer. macOS/Linux are not
    targeted.
  ────────────────────────────────────────
  Constraint: No bundler
  Detail: Vanilla JS, multi-page HTML loaded directly by Electron. No React, no
    Webpack, no build step for renderer code.
  ────────────────────────────────────────
  Constraint: Offline-first
  Detail: SQLite via better-sqlite3 with WAL mode. No cloud database. Internet
    only needed for auto-update and optional telemetry.
  ────────────────────────────────────────
  Constraint: Arabic RTL
  Detail: Entire UI is Arabic. All error messages, toasts, labels in Arabic.
  Must
    use official Moroccan educational terminology.
  ────────────────────────────────────────
  Constraint: Massar interop
  Detail: Excel import must handle Massar platform export formats — specific
    column structures, bilingual headers, student codes.
  ────────────────────────────────────────
  Constraint: FET interop
  Detail: Timetable import depends on FET software XML export format.
  ────────────────────────────────────────
  Constraint: Electron security
  Detail: contextIsolation: true, nodeIntegration: false. All IPC through
    contextBridge. No direct Node.js access from renderer.
  ────────────────────────────────────────
  Constraint: No framework CSS
  Detail: Styling appears to be custom CSS per page. No shared component library

    or design system.
  ────────────────────────────────────────
  Constraint: Private update repo
  Detail: Auto-updater targets a private GitHub repo, requiring GH_TOKEN at
  build
    time.

  Key dependencies:

  ┌──────────────────┬─────────┬────────────────────┐
  │     Package      │ Version │      Purpose       │
  ├──────────────────┼─────────┼────────────────────┤
  │ electron         │ ^35.0.0 │ Application shell  │
  ├──────────────────┼─────────┼────────────────────┤
  │ better-sqlite3   │ ^12.0.0 │ Local database     │
  ├──────────────────┼─────────┼────────────────────┤
  │ xlsx             │ ^0.18.5 │ Excel parsing      │
  ├──────────────────┼─────────┼────────────────────┤
  │ electron-updater │ ^6.8.3  │ Auto-update        │
  ├──────────────────┼─────────┼────────────────────┤
  │ dotenv           │ ^17.3.1 │ Environment config │
  └──────────────────┴─────────┴────────────────────┘

  ---
  5. Success Metrics

  Metric: Adoption
  How to measure: Active installations via telemetry heartbeats (unique devices
    seen in 30 days)
  Target: Track growth month-over-month. No baseline yet.
  ────────────────────────────────────────
  Metric: License conversion
  How to measure: Ratio of trial → paid activation (events in license_events
    table)
  Target: Establish baseline in first 6 months.
  ────────────────────────────────────────
  Metric: Data utilization
  How to measure: Number of students imported per school, number of grade
  records
    per semester
  Target: Indicates whether schools are using the app as their primary tool vs.
  a
    secondary one.
  ────────────────────────────────────────
  Metric: Feature breadth
  How to measure: Page visit distribution (which sidebar sections are actually
    used)
  Target: Identify unused features for potential removal or improvement.
    Currently not tracked — gap.
  ────────────────────────────────────────
  Metric: Retention
  How to measure: Device last-seen timestamps in telemetry. Schools that go dark

    (no heartbeat in 30+ days)
  Target: Track churn rate.
  ────────────────────────────────────────
  Metric: Support burden
  How to measure: Number of backup/restore operations, login failures, license
    activation errors (from system_logs)
  Target: High error rates indicate UX problems.

  Assumption: Feature-level analytics (which pages are visited, which actions
  are taken) are not currently instrumented beyond system logs. This is a gap
  for understanding actual usage patterns.

  ---
  6. Known Issues & Gaps

  Functional Gaps

  Issue: Timetable DB not implemented
  Severity: Medium
  Detail: timetable:getByTeacher/Room/Class IPC channels return empty arrays.
    Timetable depends entirely on pre-generated FET HTML files in a timetables/
    directory. There is no in-app timetable editing.
  ────────────────────────────────────────
  Issue: No multi-language support
  Severity: Low
  Detail: UI is hardcoded Arabic. No i18n framework. Limits adoption outside
    Arabic-speaking administrators. Acceptable for current target market.
  ────────────────────────────────────────
  Issue: Reports are client-side HTML
  Severity: Medium
  Detail: Certificate and report generation fetches data from the backend but
    renders entirely in the browser. No templating engine. Changes to report
    formats require HTML editing.
  ────────────────────────────────────────
  Issue: Prototype pages exist but are hidden
  Severity: Low
  Detail: student-profile-prototype.html and communication-center-prototype.html

    are in the codebase and sidebar but hidden by default via page visibility
    controls. Indicates planned but unfinished features.
  ────────────────────────────────────────
  Issue: Viewer role undefined
  Severity: Low
  Detail: Auth system declares three roles (admin, staff, viewer) but no IPC
    handler checks for viewer. The role exists in schema but has no distinct
    permissions.
  ────────────────────────────────────────
  Issue: No data export beyond CSV
  Severity: Medium
  Detail: Teacher performance has CSV export. No general-purpose data export
    (e.g., export student list, export absences to Excel). Import is well-built;

    export is sparse.

  Technical Debt

  Issue: Dual API surfaces
  Detail: Proctors, rooms, and teacher absences each have two parallel IPC
    channel sets (new + legacy). This creates maintenance burden and confusion.
  ────────────────────────────────────────
  Issue: Bulk operations skip auth
  Detail: addBulk, saveBulk, and deleteByYear operations do not require
    authentication because the import page runs before login. This is a security

    trade-off — any process with access to the IPC surface can bulk-modify data.
  ────────────────────────────────────────
  Issue: Hardcoded license secret
  Detail: The HMAC signing key for license serial generation is committed to the

    codebase in licenseDefaults.js. Anyone with source access can generate valid

    license keys.
  ────────────────────────────────────────
  Issue: No input validation layer
  Detail: IPC handlers insert user-provided data directly into SQL (via
    parameterized queries, so no injection risk, but no business rule validation

    — e.g., grade value ranges, date formats, required fields).
  ────────────────────────────────────────
  Issue: localStorage for timetable data
  Detail: FET timetable imports are stored in localStorage, not SQLite. This
    means timetable data is not included in the database backup (though
    localStorage is captured separately in the JSON backup).

  UX Issues

  Issue: No per-page CSS consistency
  Detail: Each HTML page is self-contained with its own styling. No shared
  design
    system or component library. Visual inconsistency is likely across pages.
  ────────────────────────────────────────
  Issue: Login not enforced on startup
  Detail: The app loads index.html (dashboard) directly. Auth is checked
    per-IPC-call but the UI doesn't gate navigation. Users can browse read-only
    pages without logging in.
  ────────────────────────────────────────
  Issue: School year format is user-typed
  Detail: Switching school years requires typing YYYY/YYYY into a prompt dialog.

    No dropdown, no validation of year sequence.

  ---
  7. Roadmap Thinking

  Near-term priorities (stabilization)

  1. Consolidate dual API surfaces. Migrate legacy IPC channels to the current
  API and update all HTML pages that reference them. This reduces the IPC
  surface by ~15 channels and eliminates a source of bugs.
  2. Enforce auth on bulk operations. The import page should require login
  before allowing bulk data modification. The current design where imports
  bypass auth is a security gap, even if it was done for convenience.
  3. Implement the viewer role. Either define what viewers can do (read-only
  access with no write IPC permissions) or remove the role from the schema. It
  currently exists but does nothing.
  4. Add Excel export. Users import from Excel but can't export back to it
  (except teacher performance CSV). Adding XLSX export for student lists,
  grades, and absences would close a significant workflow gap.

  Medium-term priorities (feature completion)

  5. Build database-backed timetable. Replace the FET static HTML dependency
  with a proper timetable data model in SQLite. Allow viewing and basic editing
  of schedules within the app. The IPC stubs already exist.
  6. Complete the student profile page. The prototype exists and is hidden. This
   is a natural aggregation point — a single view showing a student's grades,
  absences, movements, documents, and correspondence.
  7. Communication center. The prototype suggests intent to build a centralized
  notification/correspondence system. This would unify the current absence
  correspondence feature with broader parent communication.
  8. Feature usage analytics. Instrument page visits and key actions to
  understand which features schools actually use. This data should inform what
  to invest in next.

  Strategic direction

  The product occupies a specific niche: offline-first, Arabic-language school 
  administration for Moroccan high schools. The strategic moat is deep Massar
  interoperability and Moroccan educational terminology. The near-term focus
  should be on making existing features robust and complete rather than adding
  new feature areas. The licensing and telemetry infrastructure is already
  mature relative to the feature set — the product is ready for paid
  distribution once the core workflows are polished.

  The largest risk is the no-framework, multi-page architecture. It works for
  the current scope but will become increasingly expensive to maintain as the
  page count grows. Any future major feature expansion should consider whether
  the architecture can sustain it, or whether a gradual migration to a
  component-based renderer (even vanilla web components) would pay off.

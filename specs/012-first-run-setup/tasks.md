# Tasks: First-Run Setup Page

**Input**: Design documents from `/specs/012-first-run-setup/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/ipc-channels.md, quickstart.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (IPC Infrastructure)

**Purpose**: Create the IPC handler module, register it, and expose channels in preload — the three-file rule that all user stories depend on.

- [x] T001 [P] Create IPC handler module with all 4 channel stubs in `main/ipc/setup.js`

    Create a new file `main/ipc/setup.js` that exports `registerSetupIpc(ipcMain)`.

    **Require these at the top of the file:**

    ```js
    const { handleRead, handleWriteSoftAuth } = require('./ipc-helpers');
    const { hashPassword } = require('../auth/password');
    const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');
    ```

    **Register 4 channel stubs inside `registerSetupIpc(ipcMain)`:**
    1. `handleRead(ipcMain, 'setup:getInstitutionStatus', async (db) => { ... })` — Read-only, no auth. Query `SELECT setup_completed, massar_code, institution_name FROM institution_config WHERE id = 1`. Return `{ success: true, setupCompleted: Boolean, massarCode, institutionName }`. If row missing, return `{ success: true, setupCompleted: false, massarCode: null, institutionName: null }`.

    2. `handleWriteSoftAuth(ipcMain, 'setup:setupNewInstitution', [], async (db, payload) => { ... })` — Write, soft-auth (no roles required = empty array `[]`). This is the "New Institution" handler. For now, just return `{ success: false, error: 'Not implemented yet' }`. Full implementation comes in Phase 3 (T005).

    3. `handleWriteSoftAuth(ipcMain, 'setup:verifyAndLink', [], async (db, payload) => { ... })` — Write, soft-auth. This is the "Link to Existing" OTP handler. For now, just return `{ success: false, error: 'Not implemented yet' }`. Full implementation comes in Phase 4 (T010).

    4. `handleRead(ipcMain, 'setup:discoverLanDevices', async (db, payload) => { ... })` — Read-only. This is the LAN discovery proxy. For now, return `{ success: true, devices: [] }`. Full implementation comes in Phase 4 (T009).

    **Export at end of file:**

    ```js
    module.exports = { registerSetupIpc };
    ```

    **IMPORTANT notes:**
    - Use `handleWriteSoftAuth` (NOT `handleWriteNoAuth` — that function does not exist in this codebase). Pass an empty roles array `[]` so any caller (including pre-login) can use it.
    - Use `handleRead` for read-only channels.
    - Do NOT use raw `ipcMain.handle()` — this is prohibited by the project constitution.
    - Follow the existing code style: single quotes, no trailing commas, 4-space indent, semicolons.

- [x] T002 [P] Register the setup IPC module in `main/ipc/registerAll.js`

    Open `main/ipc/registerAll.js`. Make two changes:
    1. **Add require at the top** (in the block of require statements, lines 1-16):

        ```js
        const { registerSetupIpc } = require('./setup');
        ```

    2. **Add registration call** inside the `registerAllIpcHandlers(ipcMain)` function body (before the closing `}` of the function, around line 34):
        ```js
        registerSetupIpc(ipcMain);
        ```

    That's it — two lines added.

- [x] T003 [P] Add the `setup` namespace to `preload.js`

    Open `preload.js`. The `sync:` namespace is the last one (lines 287-295). Add a comma after the closing `}` of `sync` on line 295, then add the new `setup` namespace block:

    ```js
    // Setup (first-run institution setup)
    setup: {
        getInstitutionStatus: () => ipcRenderer.invoke('setup:getInstitutionStatus'),
        setupNewInstitution: (payload) => ipcRenderer.invoke('setup:setupNewInstitution', payload),
        verifyAndLink: (payload) => ipcRenderer.invoke('setup:verifyAndLink', payload),
        discoverLanDevices: (payload) => ipcRenderer.invoke('setup:discoverLanDevices', payload)
    }
    ```

    **IMPORTANT**: The last property (`discoverLanDevices`) has NO trailing comma (project style: no trailing commas). The closing `}` of `setup` also has NO trailing comma since it is the last namespace before the end of the `contextBridge.exposeInMainWorld('api', { ... })` block.

    **Verify**: The smoke test (`npm run test:smoke`) dynamically scans `preload.js` for `ipcRenderer.invoke('...')` calls and compares them against `main/ipc/*.js` handlers. After T001 + T002 + T003, all 4 new channels should match. Run `npm run test:smoke` to confirm.

**Checkpoint**: After T001 + T002 + T003, run `npm run test:smoke` — it should pass with the 4 new channels matching between preload and handlers. The stubs return placeholder responses, but IPC parity is established.

---

## Phase 2: Foundational (Startup Redirect + HTML Page Shell)

**Purpose**: Create the startup redirect in main.js and the setup.html page shell. After this phase, launching the app with no institution_config row will show the (empty) setup page instead of the login page.

**Depends on**: Phase 1 completed (IPC stubs registered)

- [x] T004 Add startup redirect logic in `main.js` at line 158

    Open `main.js`. At line 158, replace:

    ```js
    window.loadFile('index.html').catch((error) => {
        console.error('[main] Failed to load index.html:', error);
    });
    ```

    With:

    ```js
    const { getDb } = require('./main/db/context');
    const setupDb = getDb();
    const inst = setupDb.prepare('SELECT setup_completed FROM institution_config WHERE id = 1').get();
    const targetPage = !inst || !inst.setup_completed ? 'setup.html' : 'index.html';
    window.loadFile(targetPage).catch((error) => {
        console.error(`[main] Failed to load ${targetPage}:`, error);
    });
    ```

    **IMPORTANT**: `getDb()` returns the singleton database connection that is already initialized earlier in the startup sequence (`initDatabase()` runs before `createWindow()`). The query is synchronous (better-sqlite3). If `institution_config` has no row or `setup_completed` is 0/falsy, the app loads `setup.html`; otherwise it loads `index.html` as before.

    **Note**: Check if `getDb` is already imported at the top of `main.js`. If yes, reuse that import. If not, add the require. If `getDb` is available via another pattern (like `require('./main/db/init')`), use the existing pattern — search the file for how other code accesses the database.

- [x] T005 Create the `setup.html` page shell

    Create a new file `setup.html` at the project root. This is a full-screen page with NO sidebar, NO quick-nav, NO shortcuts modal. It follows the same `<head>` pattern as other pages but is stripped down since it's a pre-auth page.

    ```html
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>إعداد المؤسسة</title>
            <link rel="stylesheet" href="vendor/fonts/google-fonts.css" />
            <link rel="stylesheet" href="vendor/fontawesome/css/all.min.css" />
            <link rel="stylesheet" href="css/tailwind-output.css" />
            <script src="js/notifications.js"></script>
        </head>
        <body class="bg-secondary text-text-main font-main min-h-screen flex items-center justify-center p-4">
            <div id="toast-container" class="toast-container"></div>

            <!-- Main container: centered card with max width -->
            <div id="setup-container" class="w-full max-w-lg">
                <!-- Step 1: Mode Selection -->
                <div id="step-mode-select" class="bg-surface rounded-radius-lg shadow-card p-8">
                    <div class="text-center mb-8">
                        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                            <i class="fas fa-school text-primary text-2xl"></i>
                        </div>
                        <h1 class="text-2xl font-bold mb-2">إعداد المؤسسة</h1>
                        <p class="text-text-muted">اختر طريقة الإعداد للبدء</p>
                    </div>

                    <div class="space-y-4">
                        <!-- Card A: New Institution -->
                        <button
                            id="btn-mode-new"
                            type="button"
                            class="w-full text-start p-5 rounded-radius-md border-2 border-glass-border hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
                        >
                            <div class="flex items-center gap-4">
                                <div
                                    class="flex-shrink-0 w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
                                >
                                    <i class="fas fa-plus-circle text-green-600 dark:text-green-400 text-xl"></i>
                                </div>
                                <div>
                                    <h2 class="font-bold text-lg">مؤسسة جديدة</h2>
                                    <p class="text-text-muted text-sm">أول جهاز في المؤسسة — إنشاء حساب جديد</p>
                                </div>
                            </div>
                        </button>

                        <!-- Card B: Link to Existing -->
                        <button
                            id="btn-mode-link"
                            type="button"
                            class="w-full text-start p-5 rounded-radius-md border-2 border-glass-border hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
                        >
                            <div class="flex items-center gap-4">
                                <div
                                    class="flex-shrink-0 w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center"
                                >
                                    <i class="fas fa-link text-blue-600 dark:text-blue-400 text-xl"></i>
                                </div>
                                <div>
                                    <h2 class="font-bold text-lg">ربط بمؤسسة موجودة</h2>
                                    <p class="text-text-muted text-sm">ربط هذا الجهاز بمؤسسة تم إعدادها مسبقاً</p>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>

                <!-- Step 2a: New Institution Form (hidden initially) -->
                <div id="step-new-institution" class="bg-surface rounded-radius-lg shadow-card p-8 hidden">
                    <button
                        id="btn-back-from-new"
                        type="button"
                        class="flex items-center gap-2 text-text-muted hover:text-text-main mb-6 transition-colors"
                    >
                        <i class="fas fa-arrow-right"></i>
                        <span>رجوع</span>
                    </button>

                    <h2 class="text-xl font-bold mb-6">إعداد مؤسسة جديدة</h2>

                    <form id="form-new-institution" class="space-y-5" novalidate>
                        <!-- MASSAR Code -->
                        <div>
                            <label for="new-massar-code" class="block text-sm font-medium mb-1"
                                >رمز ماسار <span class="text-danger-bg">*</span></label
                            >
                            <input
                                type="text"
                                id="new-massar-code"
                                required
                                placeholder="مثال: M320456"
                                dir="ltr"
                                class="w-full px-4 py-2.5 rounded-radius-sm border border-glass-border bg-surface text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                            />
                            <p id="new-massar-error" class="text-danger-bg text-xs mt-1 hidden"></p>
                        </div>

                        <!-- Institution Name (optional) -->
                        <div>
                            <label for="new-institution-name" class="block text-sm font-medium mb-1"
                                >اسم المؤسسة <span class="text-text-muted text-xs">(اختياري)</span></label
                            >
                            <input
                                type="text"
                                id="new-institution-name"
                                placeholder="مثال: ثانوية الفارابي التأهيلية"
                                class="w-full px-4 py-2.5 rounded-radius-sm border border-glass-border bg-surface text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                            />
                        </div>

                        <hr class="border-glass-border" />

                        <!-- Admin Name -->
                        <div>
                            <label for="new-admin-name" class="block text-sm font-medium mb-1"
                                >اسم المدير <span class="text-danger-bg">*</span></label
                            >
                            <input
                                type="text"
                                id="new-admin-name"
                                required
                                placeholder="الاسم الكامل"
                                class="w-full px-4 py-2.5 rounded-radius-sm border border-glass-border bg-surface text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                            />
                            <p id="new-admin-name-error" class="text-danger-bg text-xs mt-1 hidden"></p>
                        </div>

                        <!-- Admin Password -->
                        <div>
                            <label for="new-admin-password" class="block text-sm font-medium mb-1"
                                >كلمة المرور <span class="text-danger-bg">*</span></label
                            >
                            <input
                                type="password"
                                id="new-admin-password"
                                required
                                placeholder="6 أحرف على الأقل"
                                class="w-full px-4 py-2.5 rounded-radius-sm border border-glass-border bg-surface text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                            />
                            <p id="new-password-error" class="text-danger-bg text-xs mt-1 hidden"></p>
                        </div>

                        <!-- Confirm Password -->
                        <div>
                            <label for="new-admin-confirm" class="block text-sm font-medium mb-1"
                                >تأكيد كلمة المرور <span class="text-danger-bg">*</span></label
                            >
                            <input
                                type="password"
                                id="new-admin-confirm"
                                required
                                placeholder="أعد إدخال كلمة المرور"
                                class="w-full px-4 py-2.5 rounded-radius-sm border border-glass-border bg-surface text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                            />
                            <p id="new-confirm-error" class="text-danger-bg text-xs mt-1 hidden"></p>
                        </div>

                        <!-- Submit -->
                        <button
                            type="submit"
                            id="btn-submit-new"
                            class="w-full py-3 rounded-radius-sm bg-primary text-white font-bold hover:bg-primary-dark transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                            <i class="fas fa-check me-2"></i>إنشاء المؤسسة
                        </button>
                    </form>
                </div>

                <!-- Step 2b: Link to Existing Form (hidden initially) -->
                <div id="step-link-existing" class="bg-surface rounded-radius-lg shadow-card p-8 hidden">
                    <button
                        id="btn-back-from-link"
                        type="button"
                        class="flex items-center gap-2 text-text-muted hover:text-text-main mb-6 transition-colors"
                    >
                        <i class="fas fa-arrow-right"></i>
                        <span>رجوع</span>
                    </button>

                    <h2 class="text-xl font-bold mb-6">ربط بمؤسسة موجودة</h2>

                    <form id="form-link-existing" class="space-y-5" novalidate>
                        <!-- MASSAR Code -->
                        <div>
                            <label for="link-massar-code" class="block text-sm font-medium mb-1"
                                >رمز ماسار <span class="text-danger-bg">*</span></label
                            >
                            <input
                                type="text"
                                id="link-massar-code"
                                required
                                placeholder="مثال: M320456"
                                dir="ltr"
                                class="w-full px-4 py-2.5 rounded-radius-sm border border-glass-border bg-surface text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                            />
                            <p id="link-massar-error" class="text-danger-bg text-xs mt-1 hidden"></p>
                        </div>

                        <!-- OTP 6-digit boxes -->
                        <div>
                            <label class="block text-sm font-medium mb-2"
                                >رمز الربط (6 أرقام) <span class="text-danger-bg">*</span></label
                            >
                            <div id="otp-container" class="flex justify-center gap-3" dir="ltr">
                                <input
                                    type="text"
                                    maxlength="1"
                                    inputmode="numeric"
                                    pattern="[0-9]"
                                    class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-radius-sm border-2 border-glass-border bg-surface text-text-main focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                                    data-index="0"
                                />
                                <input
                                    type="text"
                                    maxlength="1"
                                    inputmode="numeric"
                                    pattern="[0-9]"
                                    class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-radius-sm border-2 border-glass-border bg-surface text-text-main focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                                    data-index="1"
                                />
                                <input
                                    type="text"
                                    maxlength="1"
                                    inputmode="numeric"
                                    pattern="[0-9]"
                                    class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-radius-sm border-2 border-glass-border bg-surface text-text-main focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                                    data-index="2"
                                />
                                <input
                                    type="text"
                                    maxlength="1"
                                    inputmode="numeric"
                                    pattern="[0-9]"
                                    class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-radius-sm border-2 border-glass-border bg-surface text-text-main focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                                    data-index="3"
                                />
                                <input
                                    type="text"
                                    maxlength="1"
                                    inputmode="numeric"
                                    pattern="[0-9]"
                                    class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-radius-sm border-2 border-glass-border bg-surface text-text-main focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                                    data-index="4"
                                />
                                <input
                                    type="text"
                                    maxlength="1"
                                    inputmode="numeric"
                                    pattern="[0-9]"
                                    class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-radius-sm border-2 border-glass-border bg-surface text-text-main focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                                    data-index="5"
                                />
                            </div>
                            <p id="otp-error" class="text-danger-bg text-xs mt-2 text-center hidden"></p>
                        </div>

                        <!-- Progress indicator (hidden until submission) -->
                        <div id="link-progress" class="text-center text-sm text-text-muted hidden">
                            <i class="fas fa-spinner fa-spin me-1"></i>
                            <span id="link-progress-text">جاري البحث في الشبكة المحلية...</span>
                        </div>

                        <!-- Submit -->
                        <button
                            type="submit"
                            id="btn-submit-link"
                            class="w-full py-3 rounded-radius-sm bg-primary text-white font-bold hover:bg-primary-dark transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                            <i class="fas fa-link me-2"></i>ربط الجهاز
                        </button>
                    </form>
                </div>
            </div>

            <script src="js/pages/setup.js" defer></script>
        </body>
    </html>
    ```

    **Key design decisions in this HTML:**
    - `lang="ar" dir="rtl"` on `<html>` — required by constitution Principle III.
    - All CSS uses logical properties via Tailwind: `me-*` (margin-end), `ms-*` (margin-start), `text-start` — no `left`/`right`.
    - OTP digit container has `dir="ltr"` so digits read left-to-right (natural for numbers).
    - MASSAR code inputs have `dir="ltr"` since the codes are Latin alphanumeric.
    - All user-facing text is Arabic.
    - Toast container included for `showToast()` support (loaded via `js/notifications.js` without `defer`).
    - Three step divs: `step-mode-select` (visible), `step-new-institution` (hidden), `step-link-existing` (hidden).
    - Back buttons use `fa-arrow-right` (which visually points left in RTL = "back" direction).
    - Dark mode works automatically via Tailwind theme tokens (`bg-surface`, `text-text-main`, `border-glass-border`, etc.).
    - No sidebar, no quick-nav, no shortcuts modal — this is a pre-auth page.

**Checkpoint**: After T004 + T005, launching the app with an empty/missing `institution_config` row should display the setup page shell. The page is not yet functional (no JS logic), but the redirect works and the HTML renders correctly in RTL.

---

## Phase 3: User Story 1 — New Institution Setup (Priority: P1) 🎯 MVP

**Goal**: A school administrator can launch the app for the first time, choose "New Institution", enter MASSAR code + admin credentials, and complete setup. The app redirects to the login page with a working admin account.

**Independent Test**: Delete the `institution_config` row (or use a fresh DB), launch the app. Complete the new-institution form. Verify redirect to `index.html`. Login with the admin credentials just created.

### Implementation for User Story 1

- [x] T006 [US1] Implement the `setup:setupNewInstitution` IPC handler in `main/ipc/setup.js`

    Replace the stub for `setup:setupNewInstitution` in `main/ipc/setup.js` with the full implementation:

    ```js
    handleWriteSoftAuth(ipcMain, 'setup:setupNewInstitution', [], async (db, payload) => {
        const { massarCode, institutionName, adminName, adminPassword } = payload || {};

        // --- Input validation ---
        const trimmedMassar = (massarCode || '').trim();
        const trimmedName = (adminName || '').trim();
        const trimmedInstName = (institutionName || '').trim();

        if (!trimmedMassar || !/^[A-Za-z]\d{4,8}$/.test(trimmedMassar)) {
            return { success: false, error: 'رمز ماسار غير صالح — يجب أن يبدأ بحرف متبوعاً بـ 4-8 أرقام' };
        }
        if (!trimmedName) {
            return { success: false, error: 'اسم المدير مطلوب' };
        }
        if (!adminPassword || adminPassword.length < 6) {
            return { success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
        }

        // --- Get device info ---
        const { deviceHash, platform } = collectCurrentFingerprint();
        const os = require('os');
        const deviceName = os.hostname();
        const { app } = require('electron');
        const appVersion = app.getVersion();

        // --- Transaction: all-or-nothing ---
        const transaction = db.transaction(() => {
            // 1. Insert or update institution_config (singleton id=1)
            db.prepare(
                `INSERT INTO institution_config (id, massar_code, institution_name, setup_completed, setup_mode, setup_device_hash, updated_at)
                VALUES (1, ?, ?, 1, 'new', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    massar_code = excluded.massar_code,
                    institution_name = excluded.institution_name,
                    setup_completed = 1,
                    setup_mode = 'new',
                    setup_device_hash = excluded.setup_device_hash,
                    updated_at = CURRENT_TIMESTAMP`
            ).run(trimmedMassar, trimmedInstName || null, deviceHash);

            // 2. Update admin user (id=1, already seeded by createTables)
            const passwordHash = hashPassword(adminPassword);
            db.prepare(`UPDATE users SET name = ?, password_hash = ?, must_change_password = 0 WHERE id = 1`).run(
                trimmedName,
                passwordHash
            );

            // 3. Register this device in linked_devices
            db.prepare(
                `INSERT INTO linked_devices (device_hash, device_name, os_platform, app_version, linked_by, linked_at, last_seen_at, status)
                VALUES (?, ?, ?, ?, 'setup_new', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
                ON CONFLICT(device_hash) DO UPDATE SET
                    device_name = excluded.device_name,
                    last_seen_at = CURRENT_TIMESTAMP`
            ).run(deviceHash, deviceName, platform, appVersion);
        });

        try {
            transaction();
            return { success: true, message: 'تم إعداد المؤسسة بنجاح' };
        } catch (err) {
            console.error('[setup] setupNewInstitution error:', err);
            return { success: false, error: 'حدث خطأ أثناء إعداد المؤسسة: ' + err.message };
        }
    });
    ```

    **Key points:**
    - Uses `hashPassword()` from `main/auth/password.js` (already required at top of file from T001).
    - Uses `collectCurrentFingerprint()` from `main/licensing/deviceFingerprint.js` (already required at top from T001).
    - Uses `INSERT ... ON CONFLICT ... DO UPDATE` (SQLite UPSERT) for `institution_config` and `linked_devices` to be idempotent.
    - Updates the existing admin user row (id=1) — does NOT insert a new user. Sets `must_change_password = 0` since the user explicitly chose their password.
    - All 3 DB writes are wrapped in a single transaction for atomicity.

- [x] T007 [US1] Create the renderer logic for the new-institution flow in `js/pages/setup.js`

    Create a new file `js/pages/setup.js`. This handles all step navigation and form submission for the setup wizard.

    **For this task, implement ONLY the mode selection navigation and the new-institution form submission. The link-to-existing form logic comes in Phase 4 (T011).**

    ```js
    // js/pages/setup.js — First-run setup page logic

    document.addEventListener('DOMContentLoaded', () => {
        // --- Element references ---
        const stepModeSelect = document.getElementById('step-mode-select');
        const stepNewInstitution = document.getElementById('step-new-institution');
        const stepLinkExisting = document.getElementById('step-link-existing');

        const btnModeNew = document.getElementById('btn-mode-new');
        const btnModeLink = document.getElementById('btn-mode-link');
        const btnBackFromNew = document.getElementById('btn-back-from-new');
        const btnBackFromLink = document.getElementById('btn-back-from-link');

        const formNew = document.getElementById('form-new-institution');
        const btnSubmitNew = document.getElementById('btn-submit-new');

        // --- Helper: show/hide steps ---
        function showStep(stepEl) {
            stepModeSelect.classList.add('hidden');
            stepNewInstitution.classList.add('hidden');
            stepLinkExisting.classList.add('hidden');
            stepEl.classList.remove('hidden');
        }

        // --- Helper: show field error ---
        function showFieldError(errorElId, message) {
            const el = document.getElementById(errorElId);
            if (el) {
                el.textContent = message;
                el.classList.remove('hidden');
            }
        }

        // --- Helper: clear all field errors in a form ---
        function clearFieldErrors(formEl) {
            formEl.querySelectorAll('[id$="-error"]').forEach((el) => {
                el.textContent = '';
                el.classList.add('hidden');
            });
        }

        // --- Helper: MASSAR code validation ---
        function isValidMassarCode(code) {
            return /^[A-Za-z]\d{4,8}$/.test(code.trim());
        }

        // --- Mode selection ---
        btnModeNew.addEventListener('click', () => showStep(stepNewInstitution));
        btnModeLink.addEventListener('click', () => showStep(stepLinkExisting));

        // --- Back navigation ---
        btnBackFromNew.addEventListener('click', () => showStep(stepModeSelect));
        btnBackFromLink.addEventListener('click', () => showStep(stepModeSelect));

        // --- New Institution form submission ---
        formNew.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearFieldErrors(formNew);

            const massarCode = document.getElementById('new-massar-code').value.trim();
            const institutionName = document.getElementById('new-institution-name').value.trim();
            const adminName = document.getElementById('new-admin-name').value.trim();
            const adminPassword = document.getElementById('new-admin-password').value;
            const adminConfirm = document.getElementById('new-admin-confirm').value;

            // Client-side validation
            let hasError = false;

            if (!massarCode || !isValidMassarCode(massarCode)) {
                showFieldError('new-massar-error', 'رمز ماسار غير صالح — يجب أن يبدأ بحرف متبوعاً بـ 4-8 أرقام');
                hasError = true;
            }
            if (!adminName) {
                showFieldError('new-admin-name-error', 'اسم المدير مطلوب');
                hasError = true;
            }
            if (!adminPassword || adminPassword.length < 6) {
                showFieldError('new-password-error', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
                hasError = true;
            }
            if (adminPassword !== adminConfirm) {
                showFieldError('new-confirm-error', 'كلمتا المرور غير متطابقتين');
                hasError = true;
            }

            if (hasError) return;

            // Disable button + show loading
            const originalHTML = btnSubmitNew.innerHTML;
            btnSubmitNew.disabled = true;
            btnSubmitNew.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الإعداد...';

            try {
                const result = await window.api.setup.setupNewInstitution({
                    massarCode,
                    institutionName,
                    adminName,
                    adminPassword
                });

                if (result.success) {
                    showToast(result.message || 'تم إعداد المؤسسة بنجاح', 'success');
                    setTimeout(() => {
                        location.href = 'index.html';
                    }, 1000);
                } else {
                    showToast(result.error || 'حدث خطأ أثناء الإعداد', 'error');
                }
            } catch (err) {
                showToast('حدث خطأ غير متوقع: ' + err.message, 'error');
            } finally {
                btnSubmitNew.disabled = false;
                btnSubmitNew.innerHTML = originalHTML;
            }
        });

        // --- Link to Existing form submission (placeholder — implemented in T011) ---
        // Will be added in Phase 4
    });
    ```

    **Key points:**
    - Uses `showToast()` which is globally available from `js/notifications.js` (loaded without `defer` in setup.html).
    - Client-side validation mirrors server-side validation exactly (same MASSAR regex, same password min length).
    - After successful setup, waits 1 second (to show the success toast) before redirecting to `index.html`.
    - Button loading state follows the existing codebase pattern: save original HTML, disable, show spinner, restore in `finally`.
    - Code style: single quotes, no trailing commas, 4-space indent, semicolons.

**Checkpoint**: After T006 + T007, the complete "New Institution" flow works end-to-end:

1. Launch app with no institution → sees setup page
2. Select "مؤسسة جديدة" → sees the form
3. Fill MASSAR code + admin name + password → submit
4. App stores institution config, updates admin account, registers device
5. Redirects to `index.html` (login page)
6. Login with the admin credentials → works

This is the **MVP**. The app is usable for single-device schools at this point.

---

## Phase 4: User Story 2 — Link to Existing Institution via OTP (Priority: P1)

**Goal**: A staff member on a second device can enter MASSAR code + 6-digit OTP, verify via LAN discovery or server fallback, import configuration, and be redirected to the login page.

**Independent Test**: Set up an institution on Device 1. Generate an OTP (via the admin device). On Device 2 (fresh DB), launch the app, choose "Link to Existing", enter MASSAR + OTP. Verify it links and redirects to `index.html`.

**Depends on**: Phase 3 completed (US1 — the first device must be set up to generate an OTP).

### Implementation for User Story 2

- [x] T008 [US2] Implement the `setup:discoverLanDevices` IPC handler in `main/ipc/setup.js`

    Replace the stub for `setup:discoverLanDevices` with the real implementation. This channel proxies to the LAN discovery module (`main/linking/lan.js`) which must already exist from Phase 7.3.

    ```js
    handleRead(ipcMain, 'setup:discoverLanDevices', async (db, payload) => {
        try {
            const { discoverLanDevices } = require('../linking/lan');
            const { massarCode, timeoutMs } = payload || {};
            const trimmedMassar = (massarCode || '').trim();
            if (!trimmedMassar) {
                return { success: false, error: 'رمز ماسار مطلوب' };
            }
            const devices = await discoverLanDevices(trimmedMassar, timeoutMs || 5000);
            return { success: true, devices: devices || [] };
        } catch (err) {
            console.error('[setup] discoverLanDevices error:', err);
            return { success: true, devices: [] };
        }
    });
    ```

    **Note**: If `main/linking/lan.js` is not yet implemented (Phase 7.3 not complete), this will catch the require error and return an empty devices list, allowing the server fallback to work. The `require()` is inside the handler (not at the top level) specifically for this reason — it's a lazy/deferred require.

- [x] T009 [US2] Implement the `setup:verifyAndLink` IPC handler in `main/ipc/setup.js`

    Replace the stub for `setup:verifyAndLink` with the full implementation. This handler attempts LAN verification first, then falls back to server verification.

    ```js
    handleWriteSoftAuth(ipcMain, 'setup:verifyAndLink', [], async (db, payload) => {
        const { massarCode, otp } = payload || {};
        const trimmedMassar = (massarCode || '').trim();
        const trimmedOtp = (otp || '').trim();

        // --- Input validation ---
        if (!trimmedMassar) {
            return { success: false, error: 'رمز ماسار مطلوب' };
        }
        if (!trimmedOtp || !/^\d{6}$/.test(trimmedOtp)) {
            return { success: false, error: 'رمز الربط يجب أن يكون 6 أرقام' };
        }

        // --- Get device info ---
        const { deviceHash, platform } = collectCurrentFingerprint();
        const os = require('os');
        const deviceName = os.hostname();
        const { app } = require('electron');
        const appVersion = app.getVersion();

        let verifiedVia = null;
        let linkResult = null;

        // --- Step 1: Try LAN discovery + verification ---
        try {
            const { discoverLanDevices, verifyViaLan } = require('../linking/lan');
            const devices = await discoverLanDevices(trimmedMassar, 5000);
            if (devices && devices.length > 0) {
                const target = devices[0];
                linkResult = await verifyViaLan(
                    target.ip,
                    target.port,
                    trimmedMassar,
                    trimmedOtp,
                    deviceHash,
                    deviceName
                );
                if (linkResult && linkResult.valid) {
                    verifiedVia = 'lan';
                }
            }
        } catch (lanErr) {
            console.warn('[setup] LAN verification failed or unavailable:', lanErr.message);
        }

        // --- Step 2: If LAN failed, try server verification ---
        if (!verifiedVia) {
            try {
                const { verifyViaServer } = require('../linking/server');
                linkResult = await verifyViaServer(trimmedMassar, trimmedOtp, deviceHash, deviceName);
                if (linkResult && linkResult.valid) {
                    verifiedVia = 'server';
                }
            } catch (serverErr) {
                console.error('[setup] Server verification failed:', serverErr.message);
                return { success: false, error: 'فشل التحقق — تأكد من صحة الرمز وأن الاتصال متاح' };
            }
        }

        if (!verifiedVia || !linkResult) {
            return { success: false, error: 'الرمز غير صحيح أو منتهي الصلاحية' };
        }

        // --- Step 3: Import config and register device ---
        try {
            const transaction = db.transaction(() => {
                // 1. Store institution config
                const syncConfig = linkResult.syncConfig || {};
                db.prepare(
                    `INSERT INTO institution_config (id, massar_code, institution_name, setup_completed, setup_mode, setup_device_hash, updated_at)
                    VALUES (1, ?, ?, 1, 'linked', ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        massar_code = excluded.massar_code,
                        institution_name = excluded.institution_name,
                        setup_completed = 1,
                        setup_mode = 'linked',
                        setup_device_hash = excluded.setup_device_hash,
                        updated_at = CURRENT_TIMESTAMP`
                ).run(trimmedMassar, syncConfig.institutionName || null, deviceHash);

                // 2. Register this device
                db.prepare(
                    `INSERT INTO linked_devices (device_hash, device_name, os_platform, app_version, linked_by, linked_at, last_seen_at, status)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
                    ON CONFLICT(device_hash) DO UPDATE SET
                        device_name = excluded.device_name,
                        last_seen_at = CURRENT_TIMESTAMP`
                ).run(deviceHash, deviceName, platform, appVersion, verifiedVia === 'lan' ? 'otp_lan' : 'otp_server');

                // 3. Import sync config if provided by the admin device
                if (syncConfig.authLambdaUrl || syncConfig.awsRegion || syncConfig.licenseKey) {
                    db.prepare(
                        `INSERT INTO sync_config (id, school_id, auth_lambda_url, aws_region, license_key, sync_interval, sync_enabled, updated_at)
                        VALUES (1, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                        ON CONFLICT(id) DO UPDATE SET
                            school_id = excluded.school_id,
                            auth_lambda_url = excluded.auth_lambda_url,
                            aws_region = excluded.aws_region,
                            license_key = excluded.license_key,
                            sync_interval = excluded.sync_interval,
                            sync_enabled = 1,
                            updated_at = CURRENT_TIMESTAMP`
                    ).run(
                        trimmedMassar,
                        syncConfig.authLambdaUrl || null,
                        syncConfig.awsRegion || null,
                        syncConfig.licenseKey || null,
                        syncConfig.syncInterval || 300
                    );
                }

                // 4. Import user accounts if provided
                if (linkResult.users && Array.isArray(linkResult.users)) {
                    const upsertUser =
                        db.prepare(`INSERT INTO users (name, email, role, password_hash, must_change_password, disabled)
                        VALUES (?, ?, ?, ?, ?, 0)
                        ON CONFLICT(email) DO UPDATE SET
                            name = excluded.name,
                            role = excluded.role,
                            password_hash = excluded.password_hash`);
                    for (const user of linkResult.users) {
                        upsertUser.run(
                            user.name,
                            user.email,
                            user.role,
                            user.passwordHash,
                            user.mustChangePassword || 0
                        );
                    }
                }
            });

            transaction();
            return { success: true, message: 'تم ربط الجهاز بنجاح', verifiedVia };
        } catch (err) {
            console.error('[setup] verifyAndLink DB error:', err);
            return { success: false, error: 'حدث خطأ أثناء ربط الجهاز: ' + err.message };
        }
    });
    ```

    **Key points:**
    - LAN modules (`main/linking/lan.js`) and server module (`main/linking/server.js`) are `require()`-d lazily inside the handler to gracefully handle the case where those modules don't exist yet.
    - Both modules should return objects with `{ valid: Boolean, syncConfig: Object, users: Array }` on success.
    - Uses UPSERT for all DB writes (idempotent).
    - Imports sync config and user accounts from the admin device's response.
    - `linked_by` is set to `'otp_lan'` or `'otp_server'` depending on which method succeeded.

- [x] T010 [US2] Add the link-to-existing form submission logic to `js/pages/setup.js`

    Add the following code inside the `DOMContentLoaded` event listener in `js/pages/setup.js`, after the new-institution form listener (replacing the `// Will be added in Phase 4` comment):

    ```js
    // --- OTP digit box behavior ---
    const otpDigits = document.querySelectorAll('.otp-digit');

    otpDigits.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = val;
            if (val && index < otpDigits.length - 1) {
                otpDigits[index + 1].focus();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                otpDigits[index - 1].focus();
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 6);
            for (let i = 0; i < pasted.length && i < otpDigits.length; i++) {
                otpDigits[i].value = pasted[i];
            }
            const focusIdx = Math.min(pasted.length, otpDigits.length - 1);
            otpDigits[focusIdx].focus();
        });
    });

    // Helper: get full OTP string from digit boxes
    function getOtpValue() {
        return Array.from(otpDigits)
            .map((d) => d.value)
            .join('');
    }

    // --- Link to Existing form submission ---
    const formLink = document.getElementById('form-link-existing');
    const btnSubmitLink = document.getElementById('btn-submit-link');
    const linkProgress = document.getElementById('link-progress');
    const linkProgressText = document.getElementById('link-progress-text');

    formLink.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFieldErrors(formLink);

        const massarCode = document.getElementById('link-massar-code').value.trim();
        const otp = getOtpValue();

        // Client-side validation
        let hasError = false;
        if (!massarCode || !isValidMassarCode(massarCode)) {
            showFieldError('link-massar-error', 'رمز ماسار غير صالح — يجب أن يبدأ بحرف متبوعاً بـ 4-8 أرقام');
            hasError = true;
        }
        if (otp.length !== 6) {
            showFieldError('otp-error', 'أدخل رمز الربط المكون من 6 أرقام');
            hasError = true;
        }
        if (hasError) return;

        // Disable button + show progress
        const originalHTML = btnSubmitLink.innerHTML;
        btnSubmitLink.disabled = true;
        btnSubmitLink.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الربط...';
        linkProgress.classList.remove('hidden');
        linkProgressText.textContent = 'جاري البحث في الشبكة المحلية...';

        try {
            // Brief pause for UX (let the user see progress)
            await new Promise((r) => setTimeout(r, 500));
            linkProgressText.textContent = 'جاري التحقق من رمز الربط...';

            const result = await window.api.setup.verifyAndLink({ massarCode, otp });

            if (result.success) {
                linkProgress.classList.add('hidden');
                const viaText = result.verifiedVia === 'lan' ? 'عبر الشبكة المحلية' : 'عبر السيرفر';
                showToast(`${result.message || 'تم ربط الجهاز بنجاح'} (${viaText})`, 'success');
                setTimeout(() => {
                    location.href = 'index.html';
                }, 1500);
            } else {
                linkProgress.classList.add('hidden');
                showToast(result.error || 'فشل الربط — تأكد من صحة البيانات', 'error');
            }
        } catch (err) {
            linkProgress.classList.add('hidden');
            showToast('حدث خطأ غير متوقع: ' + err.message, 'error');
        } finally {
            btnSubmitLink.disabled = false;
            btnSubmitLink.innerHTML = originalHTML;
        }
    });
    ```

    **Key points:**
    - OTP digit boxes auto-advance focus on input, auto-backspace to previous, and handle paste (paste 6 digits across all boxes).
    - Progress text shows Arabic messages during verification.
    - On success, shows which verification method was used (LAN vs server) in the toast.
    - On failure, hides progress and shows error toast.
    - Follows the same button loading state pattern as the new-institution form.

**Checkpoint**: After T008 + T009 + T010, both setup flows are fully functional:

- "New Institution" — works end-to-end
- "Link to Existing" — works end-to-end (requires a first device with OTP generated)

---

## Phase 5: User Story 3 — Startup Redirect for Existing Installations (Priority: P2)

**Goal**: Existing installations that upgrade to a version with the setup page are NOT shown the setup screen. The migration auto-populates `institution_config` from `sync_config` for existing setups.

**Independent Test**: Upgrade an existing installation (that has `sync_config.school_id` set). After upgrade, launch the app — it should go straight to `index.html` without showing `setup.html`.

**Depends on**: Phase 2 completed (T004 — the startup redirect exists).

- [x] T011 [US3] Verify migration handles existing installations in `main/db/migrations.js`

    Open `main/db/migrations.js` and verify that the institution-device-linking migration (version `2026-03-026-institution-device-linking` or similar) includes the auto-population logic for existing installations. The migration should already exist from Phase 7.1. Verify it contains:

    ```js
    // For existing installations: auto-populate institution_config from sync_config
    const syncRow = db.prepare('SELECT school_id FROM sync_config WHERE id = 1').get();
    if (syncRow && syncRow.school_id) {
        db.prepare(
            `INSERT INTO institution_config (id, massar_code, setup_completed, setup_mode, updated_at)
            VALUES (1, ?, 1, 'new', CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                massar_code = excluded.massar_code,
                setup_completed = 1,
                updated_at = CURRENT_TIMESTAMP`
        ).run(syncRow.school_id);
    }
    ```

    **If this migration already exists and handles this correctly**: Mark this task as done — no code changes needed.

    **If the migration exists but does NOT auto-populate institution_config**: Add the above logic to the existing migration. It must run after the `CREATE TABLE IF NOT EXISTS institution_config` statement.

    **If the migration does NOT exist at all**: This is a Phase 7.1 dependency and should have been completed before this feature. Flag this as a blocker.

**Checkpoint**: After T011, existing installations are protected from seeing the setup page on upgrade. The startup redirect in `main.js` (T004) checks `institution_config.setup_completed`, which the migration sets to `1` for existing installs.

---

## Phase 6: User Story 4 — Mode Selection Navigation (Priority: P3)

**Goal**: Users can navigate back from Step 2 (either form) to Step 1 (mode selection) without losing data or causing side effects.

**Independent Test**: Select "New Institution", fill some fields, click "Back", select "Link to Existing", click "Back" again — mode selection should appear each time.

**Depends on**: Phase 3 completed (US1 — the setup.js already has back button listeners from T007).

- [x] T012 [US4] Verify back navigation works correctly in `js/pages/setup.js`

    This task verifies that the back navigation implemented in T007 works correctly. The code already includes:

    ```js
    btnBackFromNew.addEventListener('click', () => showStep(stepModeSelect));
    btnBackFromLink.addEventListener('click', () => showStep(stepModeSelect));
    ```

    **Verify these behaviors:**
    1. Clicking "رجوع" from the new-institution form returns to mode selection.
    2. Clicking "رجوع" from the link-to-existing form returns to mode selection.
    3. Form field values are preserved when going back and returning to the same form (the `showStep()` function only toggles `hidden` class — it does not clear form fields).
    4. No side effects (no IPC calls, no state changes) when navigating back.

    **If all behaviors work**: Mark this task as done — no code changes needed.

    **If form fields are cleared on back navigation**: The `showStep()` function should only add/remove the `hidden` class. Verify it does not call `form.reset()` or clear input values.

**Checkpoint**: All 4 user stories are complete and independently testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, lint, and smoke test to confirm everything works together.

- [x] T013 Run `npm run lint` and fix any ESLint errors in new/modified files

    Run `npm run lint`. The linter covers:
    - `main/ipc/setup.js` — Node globals, `no-unused-vars` warn, `no-empty` error
    - `js/pages/setup.js` — Browser globals, relaxed rules
    - `preload.js` — Node globals

    Fix any errors. Common issues:
    - Unused variables (rename with `_` prefix or remove)
    - Missing semicolons
    - Trailing commas (remove — project style forbids them)

- [x] T014 Run `npm run css:build` to verify Tailwind compiles with new classes

    Run `npm run css:build`. The setup.html uses standard Tailwind utilities and theme tokens — no custom classes should be needed. Verify the build succeeds without errors.

    If any Tailwind classes from `setup.html` are not recognized, check that they are standard Tailwind v4 utilities or are defined in `css/tailwind-input.css`.

- [x] T015 Run `npm run test:smoke` to verify IPC parity

    Run `npm run test:smoke`. The smoke test dynamically scans `preload.js` for `ipcRenderer.invoke()` calls and compares them against handlers in `main/ipc/*.js`. All 4 new channels should match:
    - `setup:getInstitutionStatus` (preload ↔ handler)
    - `setup:setupNewInstitution` (preload ↔ handler)
    - `setup:verifyAndLink` (preload ↔ handler)
    - `setup:discoverLanDevices` (preload ↔ handler)

    **If the smoke test fails with a channel mismatch**: Check that the channel names in `preload.js` exactly match the channel names in `main/ipc/setup.js`. They must be identical strings.

- [ ] T016 Manual RTL visual check

    Launch the app with `npm run dev`. Delete the `institution_config` row to trigger the setup page. Verify:
    1. The page renders correctly in RTL (text aligned right, cards flow right-to-left).
    2. Back button arrow points in the correct direction (left in RTL = fa-arrow-right icon).
    3. OTP digit boxes render left-to-right (they have `dir="ltr"` on the container).
    4. MASSAR code input is left-to-right (has `dir="ltr"`).
    5. Dark mode works (toggle theme if the app supports live theme switching, or set `data-theme="dark"` on the HTML element via DevTools).
    6. Toast notifications appear correctly.
    7. All Arabic text is readable and not truncated.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. T001, T002, T003 can run in parallel.
- **Phase 2 (Foundational)**: Depends on Phase 1 completed (IPC must be registered before the app can start).
- **Phase 3 (US1)**: Depends on Phase 2 completed (setup.html must exist). T006 and T007 can run in parallel (different files).
- **Phase 4 (US2)**: Depends on Phase 3 completed (the IPC handler file and setup.js must exist). T008 and T009 can run in parallel (same file but different handler stubs). T010 depends on T008 + T009.
- **Phase 5 (US3)**: Depends on Phase 2 completed (just verifies migration).
- **Phase 6 (US4)**: Depends on Phase 3 completed (verifies back navigation in setup.js).
- **Phase 7 (Polish)**: Depends on all phases complete. T013, T014, T015 can run in parallel.

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependencies on other stories
- **US2 (P1)**: Can start after US1 — needs the IPC handler file to exist
- **US3 (P2)**: Can start after Phase 2 — independent of US1/US2
- **US4 (P3)**: Can start after US1 — needs setup.js to exist

### Parallel Opportunities

```text
Phase 1:  T001 ──┐
          T002 ──┼── all parallel (different files)
          T003 ──┘

Phase 2:  T004 ──┐
          T005 ──┘── parallel (different files)

Phase 3:  T006 ──┐
          T007 ──┘── parallel (different files: main/ipc/setup.js vs js/pages/setup.js)

Phase 4:  T008 ──┐
          T009 ──┘── parallel (different handler stubs in same file, but can be done together)
          T010 ──── depends on T008 + T009

Phase 5:  T011 ──── can run in parallel with Phase 3/4/6

Phase 6:  T012 ──── can run in parallel with Phase 4/5

Phase 7:  T013 ──┐
          T014 ──┼── parallel
          T015 ──┘
          T016 ──── after T013-T015
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: IPC Setup (T001-T003)
2. Complete Phase 2: Startup Redirect + HTML (T004-T005)
3. Complete Phase 3: New Institution Flow (T006-T007)
4. **STOP and VALIDATE**: Test US1 independently — the app works for single-device schools
5. Run lint + smoke test

### Incremental Delivery

1. Phase 1 + Phase 2 → Setup page shell visible
2. Add US1 (Phase 3) → New institution works → **MVP ready**
3. Add US2 (Phase 4) → Device linking works → Multi-device support
4. Add US3 (Phase 5) → Upgrade safety confirmed
5. Add US4 (Phase 6) → Back navigation verified
6. Phase 7 → Polish and final verification

---

## Notes

- All tasks include exact file paths and code snippets — a less capable model should be able to implement each task directly.
- `handleWriteSoftAuth` (NOT `handleWriteNoAuth`) is the correct wrapper — `handleWriteNoAuth` does not exist in this codebase.
- The smoke test has NO hardcoded channel count — it uses dynamic set-difference comparison. Just adding channels to preload + handler is sufficient.
- The `sync:` namespace is the last one in `preload.js` — add the `setup:` namespace after it.
- The admin user (id=1) is always pre-seeded by `createTables()` — the setup page UPDATES this row, never INSERTs a new admin.
- OTP digit boxes use `dir="ltr"` since digits should read left-to-right regardless of page direction.
- MASSAR code inputs use `dir="ltr"` since the codes are Latin alphanumeric.

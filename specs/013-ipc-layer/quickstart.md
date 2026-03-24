# Quickstart: Phase 7.6 IPC Layer

## Goal

Validate the canonical linking IPC contract, the temporary setup compatibility layer, and the admin-only OTP/device-management actions before Phase 2 task generation.

## 1. Prepare the workspace

```bash
npm run lint
npm run test:smoke
```

Both commands should pass after the IPC contract, preload exposure, registration, and smoke inventory are updated.

## 2. Launch the app

```bash
npm run dev
```

Use a clean local profile or reset the local institution row so the app opens `setup.html`.

## 3. Verify pre-login renderer access

In the renderer console on `setup.html`, confirm both namespaces are available:

```js
typeof window.api.linking;
typeof window.api.setup;
await window.api.linking.getInstitutionStatus();
await window.api.setup.getInstitutionStatus();
```

Expected result:

- Both namespaces exist.
- The `setup` namespace forwards to the canonical linking contract.
- The status payload correctly reports whether setup is complete.

## 4. Validate first-device setup

From the same `setup.html` session, run:

```js
await window.api.setup.setupNewInstitution({
    massarCode: 'M320456',
    institutionName: 'ثانوية ابن سينا',
    adminName: 'مدير المؤسسة',
    adminPassword: 'secret123'
});
```

Expected result:

- The call succeeds.
- Local setup becomes complete.
- The response includes institution and current-device summaries.

## 5. Validate admin-only linking management

After signing in as the admin, open any renderer console and run:

```js
const otp = await window.api.linking.generateOtp();
await window.api.linking.getOtpStatus();
await window.api.linking.getCurrentDevice();
await window.api.linking.getLinkedDevices();
otp;
```

Expected result:

- OTP generation returns a six-digit code plus expiry metadata.
- OTP status reports the remaining lifetime and transport status.
- Current device and linked-device roster identify the local device correctly.

## 6. Validate additional-device linking

On a second clean device or profile, open `setup.html` and either use the existing form or call the contract directly:

```js
await window.api.linking.verifyAndLink({
    massarCode: 'M320456',
    otp: '123456'
});
```

Expected result:

- A valid code links the device and marks setup complete.
- An invalid or expired code returns `success: false` with a stable failure code and leaves setup incomplete.

## 7. Validate cancellation and revocation protections

From the authenticated admin session, run:

```js
await window.api.linking.cancelOtp();
await window.api.linking.getOtpStatus();
await window.api.linking.revokeDevice({ deviceHash: 'SECOND_DEVICE_HASH' });
await window.api.linking.revokeDevice({ deviceHash: 'CURRENT_DEVICE_HASH' });
```

Expected result:

- Cancelled OTPs are no longer reported as active.
- Revoking a non-current device succeeds.
- Revoking the current device fails with `CURRENT_DEVICE_PROTECTED`.

## 8. Final regression check

```bash
npm run lint
npm run test:smoke
```

The final smoke run confirms preload/handler parity and sync-capture bookkeeping for the new write channels.

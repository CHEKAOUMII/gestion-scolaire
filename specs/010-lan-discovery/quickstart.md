# Quickstart: LAN Discovery & Verification

**Feature**: 010-lan-discovery
**Date**: 2026-03-22

---

## What This Module Does

`main/linking/lan.js` enables two devices on the same local network to complete a device-linking handshake without internet access. The admin device broadcasts its presence via UDP and serves an HTTP verification endpoint. The joining device discovers the admin via UDP, then verifies an OTP code via HTTP to receive sync configuration and user accounts.

---

## Prerequisites

1. Phase 7.1 database schema is in place (`institution_config`, `device_otp`, `linked_devices` tables)
2. Phase 7.2 OTP module is complete (`main/linking/otp.js`)
3. Both devices are on the same local network and subnet

---

## Usage

### Admin Device — Start Linking Server

```js
const { startLinkingServer, stopLinkingServer } = require('./main/linking/lan');
const { generateOtp } = require('./main/linking/otp');
const { getDb } = require('./main/db/context');

const db = getDb();

// 1. Generate an OTP first (Phase 7.2)
const { otp, expiresAt } = generateOtp(db, 'M320456', adminDeviceHash);
console.log(`OTP: ${otp} — expires at ${expiresAt}`);

// 2. Start the LAN linking server
const { port, address } = await startLinkingServer(db);
console.log(`Linking server running on ${address}:${port}`);

// 3. Server auto-stops when OTP expires or is consumed
// Or stop manually:
stopLinkingServer();
```

### Joining Device — Discover & Verify

```js
const { discoverLanDevices, verifyViaLan } = require('./main/linking/lan');

// 1. Discover admin devices on LAN (5-second timeout)
const devices = await discoverLanDevices('M320456', 5000);
// → [{ ip: '192.168.1.10', port: 19876, deviceName: 'PC-ADMIN-01' }]

if (devices.length === 0) {
    console.log('No admin device found on LAN — fall back to server');
    return;
}

// 2. Verify OTP with the first discovered device
const target = devices[0];
const result = await verifyViaLan(
    target.ip,
    target.port,
    'M320456',
    '482961', // 6-digit OTP from admin
    joiningDeviceHash,
    joiningDeviceName
);

if (result.success) {
    // result.syncConfig — save to sync_config table
    // result.institution — save to institution_config table
    // result.users — import into users table
    console.log(`Linked to ${result.institution.institution_name}`);
} else {
    console.log(`Linking failed: ${result.error}`);
}
```

---

## Network Ports

| Port  | Protocol | Purpose                    |
| ----- | -------- | -------------------------- |
| 19876 | TCP/HTTP | OTP verification endpoint  |
| 19877 | UDP      | Discovery beacon broadcast |

Both ports are used only while a linking session is active and are released when the session ends.

---

## Key Behaviors

- **Auto-stop**: Server stops automatically when OTP expires or is consumed
- **Single instance**: Starting a new server stops any previously running server
- **Deduplication**: Discovery deduplicates beacons from the same IP
- **Rate limiting**: Delegates to Phase 7.2's rate limiter (5 attempts / 10 min)
- **No dependencies**: Uses only Node.js built-in `dgram` and `http` modules

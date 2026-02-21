const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

const REINSTALL_MATCH_THRESHOLD = 70;

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(String(value || ''), 'utf8')
        .digest('hex');
}

function safeExec(command) {
    try {
        return execSync(command, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1500
        }).trim();
    } catch (_err) {
        return '';
    }
}

function readWindowsMachineGuid() {
    if (process.platform !== 'win32') return '';
    const output = safeExec('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid');
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    return match ? String(match[1]).trim() : '';
}

function readWindowsWmicValue(command) {
    const output = safeExec(command);
    if (!output) return '';
    const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^serialnumber$/i.test(line));
    return lines[0] || '';
}

function collectRawSignals() {
    const cpus = os.cpus() || [];
    const cpuModel = cpus[0]?.model || '';
    const cpuCount = cpus.length;
    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    const platform = os.platform();
    const arch = os.arch();

    const interfaces = os.networkInterfaces() || {};
    const macs = [];
    Object.values(interfaces).forEach((list) => {
        (list || []).forEach((entry) => {
            if (!entry || entry.internal || !entry.mac) return;
            const mac = String(entry.mac).toLowerCase();
            if (mac && mac !== '00:00:00:00:00:00') macs.push(mac);
        });
    });

    const uniqueMacs = [...new Set(macs)].sort();

    return {
        platform,
        arch,
        cpuModel,
        cpuCount,
        totalMemMb,
        machineGuid: readWindowsMachineGuid(),
        biosSerial: process.platform === 'win32' ? readWindowsWmicValue('wmic bios get serialnumber') : '',
        baseboardSerial: process.platform === 'win32' ? readWindowsWmicValue('wmic baseboard get serialnumber') : '',
        macs: uniqueMacs
    };
}

function buildFingerprintVector(raw) {
    const memBucket = String(Math.round((Number(raw.totalMemMb || 0) / 1024) * 2) / 2);
    const vector = {
        platformHash: raw.platform ? sha256(raw.platform.toLowerCase()) : null,
        archHash: raw.arch ? sha256(raw.arch.toLowerCase()) : null,
        cpuHash: raw.cpuModel ? sha256(raw.cpuModel.toLowerCase()) : null,
        cpuCountHash: raw.cpuCount ? sha256(String(raw.cpuCount)) : null,
        memoryBucketHash: memBucket ? sha256(memBucket) : null,
        machineGuidHash: raw.machineGuid ? sha256(raw.machineGuid.toLowerCase()) : null,
        biosSerialHash: raw.biosSerial ? sha256(raw.biosSerial.toLowerCase()) : null,
        baseboardSerialHash: raw.baseboardSerial ? sha256(raw.baseboardSerial.toLowerCase()) : null,
        macHashes: (raw.macs || []).map((mac) => sha256(mac)).sort()
    };

    const deviceHashMaterial = [
        vector.cpuHash,
        vector.cpuCountHash,
        vector.memoryBucketHash,
        vector.biosSerialHash,
        vector.baseboardSerialHash,
        ...(vector.macHashes || [])
    ]
        .filter(Boolean)
        .join('|');

    const deviceHash = sha256(deviceHashMaterial || `${vector.platformHash}|${vector.archHash}`);

    return {
        vector,
        deviceHash
    };
}

function parseStoredVector(jsonText) {
    if (!jsonText) return null;
    try {
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch (_err) {
        return null;
    }
}

function scoreVectorMatch(a, b) {
    if (!a || !b) return 0;

    let matched = 0;
    let total = 0;

    const compareExact = (field, weight) => {
        if (!a[field] || !b[field]) return;
        total += weight;
        if (a[field] === b[field]) matched += weight;
    };

    compareExact('platformHash', 5);
    compareExact('archHash', 5);
    compareExact('cpuHash', 22);
    compareExact('cpuCountHash', 8);
    compareExact('memoryBucketHash', 10);
    compareExact('machineGuidHash', 10);
    compareExact('biosSerialHash', 20);
    compareExact('baseboardSerialHash', 10);

    const macA = new Set(a.macHashes || []);
    const macB = new Set(b.macHashes || []);
    if (macA.size > 0 && macB.size > 0) {
        total += 10;
        let intersects = 0;
        macA.forEach((hash) => {
            if (macB.has(hash)) intersects += 1;
        });
        const ratio = intersects / Math.max(macA.size, macB.size);
        matched += Math.round(ratio * 10);
    }

    if (total === 0) return 0;
    return Math.round((matched / total) * 100);
}

function collectCurrentFingerprint() {
    const raw = collectRawSignals();
    const built = buildFingerprintVector(raw);
    return {
        deviceHash: built.deviceHash,
        vector: built.vector,
        platform: raw.platform,
        deviceName: os.hostname() || ''
    };
}

module.exports = {
    collectCurrentFingerprint,
    parseStoredVector,
    scoreVectorMatch,
    REINSTALL_MATCH_THRESHOLD
};

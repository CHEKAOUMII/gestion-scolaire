'use strict';

/**
 * Shared JSONL log file helpers (base C11 / diagnostics).
 * Used by error-log.js and sync/conflict-forensics.js.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROTATED_FILES = 3;

/**
 * Resolve a path under userData/logs/<fileName>, with cwd/logs fallback.
 * @param {string} fileName e.g. 'app-errors.log'
 * @param {{ cache?: { path: string|null } }} [state] mutable cache holder
 */
function resolveUserDataLogPath(fileName, state) {
    if (state && state.path) return state.path;
    let resolved = null;
    try {
        const { app } = require('electron');
        const logsDir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        resolved = path.join(logsDir, fileName);
    } catch (_) {
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            resolved = path.join(logsDir, fileName);
        } catch (_err) {
            resolved = null;
        }
    }
    if (state) state.path = resolved;
    return resolved;
}

/**
 * List rotated + base log files (oldest first): .N .. .1, then base.
 */
function getRotatedLogFiles(basePath, maxRotated = DEFAULT_MAX_ROTATED_FILES) {
    if (!basePath) return [];
    const files = [];
    for (let i = maxRotated; i >= 1; i--) {
        const rotated = `${basePath}.${i}`;
        if (fs.existsSync(rotated)) files.push(rotated);
    }
    if (fs.existsSync(basePath)) files.push(basePath);
    return files;
}

function rotateIfNeeded(filePath, maxBytes = DEFAULT_MAX_LOG_BYTES, maxRotated = DEFAULT_MAX_ROTATED_FILES) {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size < maxBytes) return;

        for (let i = maxRotated - 1; i >= 1; i--) {
            const src = `${filePath}.${i}`;
            const dest = `${filePath}.${i + 1}`;
            if (fs.existsSync(src)) {
                try {
                    fs.renameSync(src, dest);
                } catch (_) {
                    /* ignore */
                }
            }
        }
        try {
            fs.renameSync(filePath, `${filePath}.1`);
        } catch (_) {
            /* ignore */
        }
    } catch (_) {
        // file doesn't exist yet
    }
}

function stripSensitive(data, sensitiveFields) {
    if (!data || typeof data !== 'object') return data;
    const fields = sensitiveFields || [];
    const clone = Array.isArray(data) ? [...data] : { ...data };
    for (const field of fields) {
        delete clone[field];
    }
    return clone;
}

function safeParse(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

function truncate(value, max) {
    if (value == null) return null;
    const str = String(value);
    return str.length > max ? str.slice(0, max) + `…[+${str.length - max}]` : str;
}

/**
 * Append one JSONL line; never throws.
 */
function appendJsonl(filePath, entry, options = {}) {
    if (!filePath) return false;
    try {
        rotateIfNeeded(filePath, options.maxBytes, options.maxRotated);
        fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    DEFAULT_MAX_LOG_BYTES,
    DEFAULT_MAX_ROTATED_FILES,
    resolveUserDataLogPath,
    getRotatedLogFiles,
    rotateIfNeeded,
    stripSensitive,
    safeParse,
    truncate,
    appendJsonl
};

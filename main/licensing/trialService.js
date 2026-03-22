/**
 * Trial Service
 * Manages the free trial period for the application.
 * Trial starts on first DB creation and is configurable (1, 3, or 6 months).
 */

const { getDb } = require('../db/context');

const TRIAL_DURATIONS = {
    '1month': 30,
    '3months': 91,
    '6months': 183
};

const DEFAULT_TRIAL_DURATION = '6months';

/**
 * Ensure the trial start date is recorded in the settings table.
 * Called once during DB init — INSERT OR IGNORE ensures it only sets on first creation.
 */
function ensureTrialStartDate(existingDb) {
    const db = existingDb || getDb();
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES('trial_start_date', ?)`).run(
        new Date().toISOString()
    );

    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES('trial_duration', ?)`).run(DEFAULT_TRIAL_DURATION);
}

/**
 * Get the current trial status.
 * @returns {{ isTrialActive: boolean, trialStartDate: string, trialEndDate: string, daysRemaining: number, trialDuration: string, trialDays: number }}
 */
function getTrialStatus() {
    const db = getDb();

    const startRow = db.prepare(`SELECT value FROM settings WHERE key = 'trial_start_date'`).get();
    const durationRow = db.prepare(`SELECT value FROM settings WHERE key = 'trial_duration'`).get();

    if (!startRow?.value) {
        // No trial start date — should not happen if ensureTrialStartDate was called
        return {
            isTrialActive: false,
            trialStartDate: null,
            trialEndDate: null,
            daysRemaining: 0,
            trialDuration: DEFAULT_TRIAL_DURATION,
            trialDays: TRIAL_DURATIONS[DEFAULT_TRIAL_DURATION]
        };
    }

    const trialDuration = durationRow?.value || DEFAULT_TRIAL_DURATION;
    const trialDays = TRIAL_DURATIONS[trialDuration] || TRIAL_DURATIONS[DEFAULT_TRIAL_DURATION];

    const startDate = new Date(startRow.value);
    if (Number.isNaN(startDate.getTime())) {
        return {
            isTrialActive: false,
            trialStartDate: startRow.value,
            trialEndDate: null,
            daysRemaining: 0,
            trialDuration,
            trialDays
        };
    }

    const endDate = new Date(startDate.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const now = Date.now();
    const remainingMs = endDate.getTime() - now;
    const daysRemaining = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
    const isTrialActive = remainingMs > 0;

    return {
        isTrialActive,
        trialStartDate: startDate.toISOString(),
        trialEndDate: endDate.toISOString(),
        daysRemaining,
        trialDuration,
        trialDays
    };
}

/**
 * Set the trial duration (admin-only action).
 * @param {string} duration - '1month', '3months', or '6months'
 */
function setTrialDuration(duration) {
    if (!TRIAL_DURATIONS[duration]) {
        return { success: false, error: 'Invalid trial duration. Use: 1month, 3months, 6months' };
    }

    const db = getDb();
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'trial_duration'`).run(duration);

    return { success: true, trialStatus: getTrialStatus() };
}

module.exports = {
    ensureTrialStartDate,
    getTrialStatus,
    setTrialDuration
};

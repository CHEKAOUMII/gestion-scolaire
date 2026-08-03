'use strict';

const { getCycleDefinition } = require('../../js/shared/education/cycles');

const CONTEXT_BY_SENDER = new Map();

function buildContext(userId, cycleCode, schoolYear) {
    const cycle = getCycleDefinition(cycleCode);
    if (!cycle) {
        throw new Error('السلك التعليمي غير معروف');
    }
    return {
        userId: Number(userId) || 0,
        cycleCode: cycle.cycleCode,
        schoolYear: String(schoolYear || '').trim(),
        changedAt: new Date().toISOString()
    };
}

// Request paths must receive the cycle explicitly (multi-stage plan S1, G3):
// there is no default cycle, and an absent/unknown cycle fails in buildContext
// instead of silently resolving to qualifiant.
function getContext(event, userId, defaultSchoolYear, defaultCycleCode) {
    const senderId = event?.sender?.id;
    if (!senderId) throw new Error('جلسة المستخدم غير صالحة');
    const existing = CONTEXT_BY_SENDER.get(senderId);
    if (
        existing &&
        existing.userId === Number(userId) &&
        existing.schoolYear === String(defaultSchoolYear || '').trim()
    ) return existing;
    const context = buildContext(userId, defaultCycleCode, defaultSchoolYear);
    CONTEXT_BY_SENDER.set(senderId, context);
    return context;
}

function setContext(event, userId, cycleCode, schoolYear) {
    const senderId = event?.sender?.id;
    if (!senderId) throw new Error('جلسة المستخدم غير صالحة');
    const context = buildContext(userId, cycleCode, schoolYear);
    CONTEXT_BY_SENDER.set(senderId, context);
    return context;
}

/**
 * Read the sender's context without creating one (plan §5.4).
 *
 * Reads must observe the active cycle, never establish it — a read that could
 * create a context would let the first query after login pin an arbitrary cycle.
 * Returns null when the sender has not selected a cycle yet.
 */
function peekContext(event) {
    const senderId = event?.sender?.id;
    if (!senderId) return null;
    return CONTEXT_BY_SENDER.get(senderId) || null;
}

function clearContextForSender(senderId) {
    CONTEXT_BY_SENDER.delete(senderId);
}

function clearContextsForCycle(cycleCode) {
    for (const [senderId, context] of CONTEXT_BY_SENDER) {
        if (context.cycleCode === cycleCode) CONTEXT_BY_SENDER.delete(senderId);
    }
}

module.exports = { getContext, setContext, peekContext, clearContextForSender, clearContextsForCycle };

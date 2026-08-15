'use strict';

const { CYCLE_CATALOG, getCycleDefinition, normalizeCapability } = require('../../js/shared/education/cycles');
const { captureInputUpserts, notifyCaptureCommitted } = require('./capture-port');

function withCycleLabel(row) {
    if (!row) return null;
    const definition = getCycleDefinition(row.cycle_code);
    return {
        ...row,
        label_ar: definition?.labelAr || row.cycle_code,
        label_fr: definition?.labelFr || row.cycle_code,
        capability: normalizeCapability(definition?.capability)
    };
}

function listCycleCatalog() {
    return CYCLE_CATALOG.map((definition) => ({
        cycle_code: definition.cycleCode,
        label_ar: definition.labelAr,
        label_fr: definition.labelFr,
        sort_order: definition.sortOrder,
        seed_profile_version_hint: definition.seedProfileVersionHint,
        capability: definition.capability
    }));
}

function listCycles(db) {
    return db
        .prepare(
            `SELECT id, cycle_code, is_active, seed_profile_version_hint, created_at, updated_at
             FROM institution_cycles ORDER BY sort_order, cycle_code`
        )
        .all()
        .map(withCycleLabel);
}

function getActiveCycle(db, cycleCode) {
    return db
        .prepare(
            `SELECT id, cycle_code, is_active, seed_profile_version_hint, created_at, updated_at
             FROM institution_cycles WHERE cycle_code = ? LIMIT 1`
        )
        .get(cycleCode) || null;
}

function getLabeledCycle(db, cycleCode) {
    return withCycleLabel(getActiveCycle(db, cycleCode));
}

function assertKnownCycle(cycleCode) {
    const definition = getCycleDefinition(cycleCode);
    if (!definition) throw new Error('السلك التعليمي غير معروف');
    return definition;
}

function captureCycleMutation(db, cycleCode) {
    captureInputUpserts(db, {
        tableName: 'institution_cycles',
        keyFields: ['cycle_code'],
        items: [{ cycle_code: cycleCode }]
    });
}

function addCycle(db, cycleCode) {
    const definition = assertKnownCycle(cycleCode);
    const insertCycle = db.transaction(() => {
        if (getActiveCycle(db, definition.cycleCode)) throw new Error('السلك مضاف مسبقاً إلى المؤسسة');
        db.prepare(
            `INSERT INTO institution_cycles(cycle_code, is_active, seed_profile_version_hint, sort_order, updated_at)
             VALUES (?, 1, ?, ?, CURRENT_TIMESTAMP)`
        ).run(definition.cycleCode, definition.seedProfileVersionHint, definition.sortOrder);
        captureCycleMutation(db, definition.cycleCode);
    });
    insertCycle();
    notifyCaptureCommitted();
    return getLabeledCycle(db, definition.cycleCode);
}

function assertDisableKeepsInstitutionUsable(db, cycleCode) {
    // A cycle that is enabled but still `preview` cannot be worked in, so the
    // last *supported* enabled cycle must survive — otherwise the institution ends up
    // with rows in institution_cycles but no cycle any session can select.
    const remaining = listCycles(db).filter(
        (cycle) => Number(cycle.is_active) && cycle.cycle_code !== cycleCode
    );
    if (!remaining.length) throw new Error('لا يمكن تعطيل آخر سلك مفعل في المؤسسة');
    if (!remaining.some((cycle) => cycle.capability === 'supported')) {
        throw new Error('لا يمكن تعطيل آخر سلك جاهز للعمل في المؤسسة');
    }
}

function setCycleActive(db, cycleCode, isActive) {
    assertKnownCycle(cycleCode);
    const updateCycle = db.transaction(() => {
        const currentCycle = getActiveCycle(db, cycleCode);
        if (!currentCycle) throw new Error('السلك غير مضاف إلى المؤسسة');
        if (!isActive && Number(currentCycle.is_active)) {
            assertDisableKeepsInstitutionUsable(db, cycleCode);
        }
        db.prepare(
            `UPDATE institution_cycles SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE cycle_code = ?`
        ).run(isActive ? 1 : 0, cycleCode);
        captureCycleMutation(db, cycleCode);
    });
    updateCycle();
    notifyCaptureCommitted();
    return getLabeledCycle(db, cycleCode);
}

function assertCycleIsActive(db, cycleCode) {
    const cycle = getLabeledCycle(db, cycleCode);
    if (!cycle || !Number(cycle.is_active)) throw new Error('السلك غير مفعل في هذه المؤسسة');
    if (cycle.capability !== 'supported') throw new Error('هذا السلك قيد الإعداد وغير متاح للعمل بعد');
    return cycle;
}

module.exports = { listCycleCatalog, listCycles, getActiveCycle, getLabeledCycle, addCycle, setCycleActive, assertCycleIsActive };

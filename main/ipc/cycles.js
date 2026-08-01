'use strict';

const { BrowserWindow } = require('electron');

const { handleRead, handleAuthedRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { requireAuth } = require('./auth');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { filterAuthorizedCycles, assertCycleAuthorized } = require('../auth/cycle-access');

const cyclesRepo = require('../repos/cycles');
const activeCycleContext = require('../auth/active-cycle-context');

// Cycle membership is institution-wide, so every open window must refresh its
// switcher and management list — not only the window that made the change.
// Mirrors broadcastPageAccessChanged() in appDefaults.js. Never throws.
function broadcastCycleConfigurationChanged() {
    try {
        for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            win.webContents.send('cycles:configurationChanged');
        }
    } catch {
        // Broadcasting must never break the write response.
    }
}

function registerCyclesIpc(ipcMain) {
    handleRead(ipcMain, 'cycles:getCatalog', () => ({ success: true, cycles: cyclesRepo.listCycleCatalog() }));
    handleAuthedRead(ipcMain, 'cycles:list', ({ db, session }) => ({
        success: true,
        cycles: filterAuthorizedCycles(db, cyclesRepo.listCycles(db), session)
    }));

    handleAuthedRead(ipcMain, 'cycles:getActive', ({ db, event, session }) => {
        const visibleCycles = filterAuthorizedCycles(
            db,
            cyclesRepo.listCycles(db).filter((cycle) => Number(cycle.is_active) && cycle.capability === 'supported'),
            session
        );
        const defaultCycleCode = visibleCycles[0]?.cycle_code;
        if (!defaultCycleCode) throw new Error('لا يوجد سلك مصرح ومتاح للعمل');
        const schoolYear = normalizeYear(null);
        const existingContext = activeCycleContext.peekContext(event);
        const existingCycle = existingContext?.cycleCode
            ? visibleCycles.find((cycle) => cycle.cycle_code === existingContext.cycleCode)
            : null;
        const context =
            existingCycle && existingContext.userId === Number(session.userId) && existingContext.schoolYear === schoolYear
                ? existingContext
                : activeCycleContext.setContext(event, session.userId, defaultCycleCode, schoolYear);
        const cycle = cyclesRepo.getLabeledCycle(db, context.cycleCode);
        return { success: true, context, cycle };
    });

    handleWrite(ipcMain, 'cycles:add', ['admin', 'principal'], (db, event, payload) => {
        const cycle = cyclesRepo.addCycle(db, payload?.cycleCode);
        broadcastCycleConfigurationChanged();
        return { success: true, cycle };
    });

    handleWrite(ipcMain, 'cycles:setActive', ALLOWED_ROLES, (db, event, payload) => {
        const session = requireAuth(event);
        const cycleCode = String(payload?.cycleCode || '').trim();
        assertCycleAuthorized(db, session, cycleCode);
        cyclesRepo.assertCycleIsActive(db, cycleCode);
        const schoolYear = requireSchoolYear(payload?.schoolYear);
        const context = activeCycleContext.setContext(event, session.userId, cycleCode, schoolYear);
        event.sender.send('cycles:changed', context);
        return { success: true, context };
    });

    handleWrite(ipcMain, 'cycles:setEnabled', ['admin', 'principal'], (db, event, payload) => {
        if (typeof payload?.isActive !== 'boolean') throw new Error('حالة تفعيل السلك غير صالحة');
        const cycle = cyclesRepo.setCycleActive(db, payload.cycleCode, payload.isActive);
        if (!payload.isActive) activeCycleContext.clearContextsForCycle(cycle.cycle_code);
        broadcastCycleConfigurationChanged();
        return { success: true, cycle };
    });
}

module.exports = { registerCyclesIpc };

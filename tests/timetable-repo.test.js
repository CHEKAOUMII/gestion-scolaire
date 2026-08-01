'use strict';

const assert = require('assert');
const timetableRepo = require('../main/repos/timetable.js');

function createFakeDb() {
    const rows = [];
    return {
        prepare(sql) {
            return {
                run(...args) {
                    if (sql.includes('INSERT INTO timetable_data')) {
                        const [schoolYear, cycleCode, dataJson] = args;
                        const existing = rows.find((row) => row.school_year === schoolYear && row.cycle_code === cycleCode);
                        if (existing) existing.data_json = dataJson;
                        else rows.push({ school_year: schoolYear, cycle_code: cycleCode, data_json: dataJson, updated_at: null });
                        return { changes: 1 };
                    }
                    if (sql.includes('DELETE FROM timetable_data')) {
                        const [schoolYear, cycleCode] = args;
                        const before = rows.length;
                        rows.splice(
                            0,
                            rows.length,
                            ...rows.filter((row) => row.school_year !== schoolYear || row.cycle_code !== cycleCode)
                        );
                        return { changes: before - rows.length };
                    }
                    throw new Error(`Unexpected SQL in test double: ${sql}`);
                },
                get(...args) {
                    const row = rows.find((candidate) => candidate.school_year === args[0] && candidate.cycle_code === args[1]);
                    return row || null;
                },
                all(...args) {
                    const [schoolYear, ...cycleCodes] = args;
                    return rows
                        .filter((row) => row.school_year === schoolYear && cycleCodes.includes(row.cycle_code))
                        .sort((left, right) => left.cycle_code.localeCompare(right.cycle_code));
                }
            };
        }
    };
}

const db = createFakeDb();
const year = '2026/2027';
timetableRepo.upsertByCycle(db, year, 'secondary_qualifiant', '{"timetables":{"Q":{}}}');
timetableRepo.upsertByCycle(db, year, 'secondary_collegial', '{"timetables":{"C":{}}}');
timetableRepo.upsertByCycle(db, '2025/2026', 'secondary_qualifiant', '{"timetables":{"OLD":{}}}');

assert.deepStrictEqual(
    JSON.parse(timetableRepo.getByCycle(db, year, 'secondary_qualifiant').data_json),
    { timetables: { Q: {} } }
);
assert.strictEqual(timetableRepo.getAllBySchoolYear(db, year, ['secondary_qualifiant']).length, 1);
assert.strictEqual(timetableRepo.getAllBySchoolYear(db, year, ['secondary_qualifiant', 'secondary_collegial']).length, 2);
assert.strictEqual(timetableRepo.getAllBySchoolYear(db, year, []).length, 0);
assert.throws(() => timetableRepo.getByCycle(db, year, ''), /cycle_code is required/);

timetableRepo.deleteByCycle(db, year, 'secondary_collegial');
assert.strictEqual(timetableRepo.getByCycle(db, year, 'secondary_collegial'), null);
assert.notStrictEqual(timetableRepo.getByCycle(db, '2025/2026', 'secondary_qualifiant'), null);

console.log('timetable-repo: OK');

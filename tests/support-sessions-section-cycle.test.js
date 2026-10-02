'use strict';

/**
 * Section-name inference is a veto, not a source of truth (multi-cycle plan §7.3, §13).
 *
 * The cycle written to a support session always comes from the session context. The
 * section name is only consulted to catch a contradiction — "you are in the qualifiant
 * cycle but this section is clearly a collegial one". An earlier version threw whenever
 * inference returned nothing, which locked out every school whose section naming does not
 * follow the Massar codes the catalog knows.
 */

const assert = require('assert');
const { requireSectionCycle } = require('../main/ipc/support-sessions');

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';

console.log('[test] support session section/cycle agreement');

// A section the catalog recognises as the active cycle's: accepted.
assert.strictEqual(requireSectionCycle('2BACSP-1', QUALIFIANT), QUALIFIANT);
assert.strictEqual(requireSectionCycle('TCSF-4', QUALIFIANT), QUALIFIANT);
assert.strictEqual(requireSectionCycle('1APIC-2', COLLEGIAL), COLLEGIAL);
console.log('  [ok] a recognised section in the active cycle is accepted');

// A section the catalog cannot classify: accepted into the active cycle, because the
// alternative is refusing all locally-named sections for no isolation benefit.
for (const section of ['قسم الدعم 1', 'TC-SC', '', null, 'A1']) {
    assert.strictEqual(
        requireSectionCycle(section, QUALIFIANT),
        QUALIFIANT,
        `unclassifiable section ${JSON.stringify(section)} must not be rejected`
    );
}
console.log('  [ok] a section the catalog cannot classify falls to the session cycle');

// A section that provably belongs to the other cycle: refused, in Arabic.
assert.throws(
    () => requireSectionCycle('1APIC-2', QUALIFIANT),
    (err) => /ينتمي إلى سلك آخر/.test(err.message),
    'a collegial section must be refused while the qualifiant cycle is active'
);
assert.throws(
    () => requireSectionCycle('2BACSP-1', COLLEGIAL),
    (err) => /ينتمي إلى سلك آخر/.test(err.message),
    'a qualifiant section must be refused while the collegial cycle is active'
);
console.log('  [ok] a section that belongs to the other cycle is refused');

console.log('[test] support session section/cycle agreement: all checks passed');

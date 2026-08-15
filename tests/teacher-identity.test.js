'use strict';

/**
 * Phase 1 (docs/reviews/2026-08-04-import-pipeline-review.md §5.5, items 6-10) —
 * shared deterministic teacher-identity key.
 *
 * The three teacher-name sources (FET XML, grade-Excel heading, Ministry roster)
 * represent the same identity in different orders/scripts/separators. This file
 * pins the canonical-key equivalence table: normalizeIdentityKey must collapse
 * separators, titles, Arabic diacritics and token order, while a Latin name keeps
 * its own distinct key.
 */

const assert = require('assert');
const TeacherIdentity = require('../js/shared/teacher-identity');

function run() {
    const {
        foldArabic,
        stripTitlePrefix,
        tokenizeName,
        normalizeIdentityKey,
        buildNameVariants
    } = TeacherIdentity;

    assert.strictEqual(typeof normalizeIdentityKey, 'function');
    assert.strictEqual(typeof buildNameVariants, 'function');

    const ministryKey = normalizeIdentityKey('نور الدين السعيدي');
    assert.ok(ministryKey, 'Ministry Arabic name must produce a key');

    const equivalence = [
        'نور_الدين_السعيدي_',
        'الأستاذ: نور الدين السعيدي',
        'نور الدين السعيدي',
        'السعيدي نور الدين',
        'نور__الدين_السعيدي',
        'نُور الدِّين السَّعيدي'
    ];
    for (const source of equivalence) {
        assert.strictEqual(
            normalizeIdentityKey(source),
            ministryKey,
            `normalizeIdentityKey must agree across sources: ${JSON.stringify(source)}`
        );
    }

    const latinKey = normalizeIdentityKey('EL SAIDI Noureddine');
    assert.ok(latinKey, 'Latin name must produce its own key');
    assert.notStrictEqual(latinKey, ministryKey, 'Latin and Arabic keys must not collide');
    assert.strictEqual(normalizeIdentityKey('Noureddine EL SAIDI'), latinKey, 'Latin order must collapse');

    const bareName = 'محمد العلي';
    for (const titled of ['الأستاذ: محمد العلي', 'أ.د. محمد العلي', 'Dr. Mohamed El Ali', 'M. Karim Ben Ali']) {
        const key = normalizeIdentityKey(titled);
        assert.ok(key, `titled name must not vanish: ${JSON.stringify(titled)}`);
        assert.ok(!/استاذ|دكتور|dr|prof/.test(key), `title tokens must be stripped: ${JSON.stringify(titled)}`);
    }
    assert.strictEqual(normalizeIdentityKey('الأستاذ: محمد العلي'), normalizeIdentityKey(bareName));

    assert.strictEqual(normalizeIdentityKey('نور الدين السعيدي  '), ministryKey, 'trailing spaces');
    assert.strictEqual(normalizeIdentityKey('نور__الدين_السعيدي_'), ministryKey, 'double underscore artifact');
    assert.strictEqual(normalizeIdentityKey('أحمد'), normalizeIdentityKey('احمد'), 'hamza folding');
    assert.strictEqual(normalizeIdentityKey('حسن'), normalizeIdentityKey('حسن'), 'tashkeel-free same');
    assert.strictEqual(normalizeIdentityKey('نور الدين السعيدي'), normalizeIdentityKey('نور الدين السعيدي'));

    const firstFirst = normalizeIdentityKey('محمد أحمد');
    const familyFirst = normalizeIdentityKey('أحمد محمد');
    assert.strictEqual(firstFirst, familyFirst, 'identical token multisets collide by design (ambiguous)');

    const tokens = tokenizeName('الأستاذ: نور الدين السعيدي');
    assert.deepStrictEqual(tokens, ['نور', 'الدين', 'السعيدي']);
    assert.strictEqual(stripTitlePrefix('الأستاذة: فاطمة الزهراء'), 'فاطمه الزهراء');
    assert.strictEqual(foldArabic('أحمد إبراهيم آدم'), 'احمد ابراهيم ادم');

    const arabicVariants = buildNameVariants('نور الدين السعيدي');
    assert.ok(arabicVariants.length >= 1, 'Arabic variants must not be empty');
    for (const variant of arabicVariants) {
        assert.strictEqual(
            normalizeIdentityKey(variant),
            ministryKey,
            `every Arabic variant must normalize to the same key: ${JSON.stringify(variant)}`
        );
    }
    assert.strictEqual(arabicVariants[0], 'نور الدين السعيدي');
    assert.strictEqual(arabicVariants.length, 2, 'two-token-plus names yield original + reversed');
    assert.notStrictEqual(arabicVariants[1], arabicVariants[0]);

    const latinVariants = buildNameVariants('EL SAIDI Noureddine');
    assert.strictEqual(latinVariants[0], 'el saidi noureddine');
    assert.strictEqual(latinVariants[1], 'noureddine saidi el');
    for (const variant of latinVariants) {
        assert.strictEqual(normalizeIdentityKey(variant), latinKey);
    }

    assert.strictEqual(normalizeIdentityKey(''), '');
    assert.strictEqual(normalizeIdentityKey('   '), '');
    assert.strictEqual(normalizeIdentityKey('الأستاذ:'), '');
    assert.deepStrictEqual(buildNameVariants(''), []);
    assert.deepStrictEqual(buildNameVariants('   '), []);
    assert.deepStrictEqual(buildNameVariants('أحمد'), ['احمد']);
    assert.strictEqual(normalizeIdentityKey('أحمد'), 'احمد');
    assert.strictEqual(normalizeIdentityKey('MOHAMED'), 'mohamed');

    console.log('teacher-identity.test.js: OK');
}

run();

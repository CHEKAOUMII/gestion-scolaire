'use strict';

// CH8: student gender helpers (js/shared/gender.js)
//
//   node tests/gender-helpers-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { isMale, isFemale, getGenderLabel, getGenderIcon } = require('../js/shared/gender.js');

assert.ok(isMale('m'));
assert.ok(isMale('M'));
assert.ok(isMale('male'));
assert.ok(isMale('ذكر'));
assert.ok(!isMale('f'));
assert.ok(!isMale(''));

assert.ok(isFemale('f'));
assert.ok(isFemale('F'));
assert.ok(isFemale('female'));
assert.ok(isFemale('أنثى'));
assert.ok(!isFemale('m'));

assert.strictEqual(getGenderLabel('m'), 'ذكر');
assert.strictEqual(getGenderLabel('f'), 'أنثى');
assert.strictEqual(getGenderLabel('x'), '-');
assert.strictEqual(getGenderIcon('m'), 'fa-mars');
assert.strictEqual(getGenderIcon('f'), 'fa-venus');
assert.strictEqual(getGenderIcon(''), 'fa-genderless');

// Consumers must not redefine student gender helpers
for (const rel of ['js/pages/students-list.js', 'js/pages/student-profile.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!/function\s+isMale\b/.test(src), rel + ' must not define isMale');
    assert.ok(!/function\s+isFemale\b/.test(src), rel + ' must not define isFemale');
    assert.ok(
        /\b(isMale|isFemale|getGenderLabel|getGenderIcon)\s*\(/.test(src),
        rel + ' must call shared gender helpers'
    );
}

// teachers-list keeps its own teacher-object gender API (different domain)
const tl = fs.readFileSync(path.join(__dirname, '..', 'js/pages/teachers-list.js'), 'utf8');
assert.ok(/function\s+isMale\s*\(\s*t\s*\)/.test(tl), 'teachers-list keeps teacher isMale(t)');

for (const rel of ['students-list.html', 'student-profile-prototype.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(html.includes('js/shared/gender.js'), rel + ' must load gender.js');
}

console.log('gender-helpers-unit: OK');

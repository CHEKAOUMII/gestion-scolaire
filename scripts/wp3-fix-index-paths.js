'use strict';

const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'main/sync/engine/index.js');
let s = fs.readFileSync(p, 'utf8');

const pairs = [
    ["require('../firebase/", "require('../../firebase/"],
    ["require('../db/", "require('../../db/"],
    ["require('../diagnostics/", "require('../../diagnostics/"]
];

for (const [from, to] of pairs) {
    const count = s.split(from).length - 1;
    console.log(from, '->', to, 'count', count);
    s = s.split(from).join(to);
}

fs.writeFileSync(p, s);
console.log('paths fixed');

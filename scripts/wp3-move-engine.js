'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engineJs = path.join(root, 'main/sync/engine.js');
const engineDir = path.join(root, 'main/sync/engine');
const indexJs = path.join(engineDir, 'index.js');

const src = fs.readFileSync(engineJs, 'utf8');
if (src.includes("module.exports = require('./engine/index')")) {
    console.log('Already moved; skip');
    process.exit(0);
}

let out = src;
const rewrites = [
    ["require('./engine/expand-bulk')", "require('./expand-bulk')"],
    ["require('./credentials')", "require('../credentials')"],
    ["require('./capture')", "require('../capture')"],
    ["require('./authority')", "require('../authority')"],
    ["require('./merge')", "require('../merge')"],
    ["require('./conflict-forensics')", "require('../conflict-forensics')"],
    ["require('./entity-registry')", "require('../entity-registry')"],
    ["require('./apply-hooks')", "require('../apply-hooks')"]
];

for (const [from, to] of rewrites) {
    if (!out.includes(from)) {
        console.warn('warn: pattern not found:', from);
    }
    out = out.split(from).join(to);
}

fs.mkdirSync(engineDir, { recursive: true });
fs.writeFileSync(indexJs, out);
fs.writeFileSync(
    engineJs,
    [
        "'use strict';",
        '',
        '/** Compatibility façade — implementation lives in main/sync/engine/*. */',
        "module.exports = require('./engine/index');",
        ''
    ].join('\n')
);

console.log('Moved engine.js -> engine/index.js and wrote façade');
console.log('index bytes:', out.length);

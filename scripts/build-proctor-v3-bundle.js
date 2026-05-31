'use strict';

/**
 * build-proctor-v3-bundle.js
 *
 * Bundles the multi-file CommonJS V3 proctor-distribution module
 * (`js/algorithms/proctor-v3/`) into a single browser-loadable script
 * `js/algorithms/proctor-v3.bundle.js` that exposes
 * `window.ProctorDistributionV3 = { run, _internals }`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Electron renderer that hosts `exams-proctors.html` runs fully
 * sandboxed (`nodeIntegration: false`, `contextIsolation: true`,
 * `sandbox: true` — see `main.js`). `require()` is therefore NOT available
 * in the renderer. V2 (`js/algorithms/proctor-distribution-v2.js`) sidesteps
 * this by being a single self-contained file that assigns
 * `window.ProctorDistributionV2`. V3 is intentionally a clean multi-file
 * Node module (23 files, all `require()`-based per its design), which a bare
 * `<script src>` tag cannot load.
 *
 * Rather than edit the (already complete + Node-tested) V3 source files to
 * be browser-aware, this script wraps each file VERBATIM in a CommonJS
 * module closure and ships them with a minimal `require`/`module`/`exports`
 * + `path.join` shim — exactly the technique a bundler (webpack/rollup) uses.
 * The V3 source files stay untouched; the bundle is regenerable.
 *
 * The only Node built-in the V3 module touches is `path` (just
 * `path.join` + `__dirname`), which the shim implements in pure JS.
 * `js/data/proctor-key-resolver.js` is included because `10-finalize.js`
 * requires it.
 *
 * USAGE
 * -----
 *   node scripts/build-proctor-v3-bundle.js
 *   npm run build:v3-bundle
 *
 * The bundle is deterministic: files are emitted in sorted order so
 * re-running produces byte-identical output when the source is unchanged.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const V3_DIR = path.join(ROOT, 'js', 'algorithms', 'proctor-v3');
const RESOLVER = path.join(ROOT, 'js', 'data', 'proctor-key-resolver.js');
const OUT_FILE = path.join(ROOT, 'js', 'algorithms', 'proctor-v3.bundle.js');

const ENTRY_ID = '/js/algorithms/proctor-v3/index.js';

/**
 * Recursively collect all `.js` files under `dir`.
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
function collectJsFiles(dir) {
    const out = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectJsFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Convert an absolute on-disk path into the virtual module id used inside
 * the bundle: a POSIX, workspace-rooted, leading-slash path. This mirrors
 * the real relative directory structure so that the `../../../data/...`
 * traversal in `10-finalize.js` resolves to the resolver module id.
 * @param {string} absPath
 * @returns {string}
 */
function toModuleId(absPath) {
    const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
    return '/' + rel;
}

function buildBundle() {
    const files = [];

    // V3 module files (sorted for determinism).
    for (const f of collectJsFiles(V3_DIR)) {
        files.push(f);
    }
    // Dependency outside the V3 tree.
    files.push(RESOLVER);

    // Sort by virtual module id so output ordering is stable.
    const modules = files
        .map((absPath) => ({ id: toModuleId(absPath), source: fs.readFileSync(absPath, 'utf8') }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const parts = [];

    parts.push('/*');
    parts.push(' * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.');
    parts.push(' *');
    parts.push(' * Browser bundle of the V3 proctor-distribution module.');
    parts.push(' * Source: js/algorithms/proctor-v3/ + js/data/proctor-key-resolver.js');
    parts.push(' * Regenerate with: node scripts/build-proctor-v3-bundle.js (npm run build:v3-bundle)');
    parts.push(' *');
    parts.push(' * Exposes: window.ProctorDistributionV3 = { run, _internals }');
    parts.push(' */');
    parts.push('(function (global) {');
    parts.push("    'use strict';");
    parts.push('');
    parts.push('    var __modules = {};');
    parts.push('    var __cache = {};');
    parts.push('');
    parts.push('    function __normalize(p) {');
    parts.push("        var isAbs = p.charAt(0) === '/';");
    parts.push("        var segs = p.split('/');");
    parts.push('        var out = [];');
    parts.push('        for (var i = 0; i < segs.length; i += 1) {');
    parts.push('            var seg = segs[i];');
    parts.push("            if (seg === '' || seg === '.') continue;");
    parts.push("            if (seg === '..') { if (out.length) out.pop(); continue; }");
    parts.push('            out.push(seg);');
    parts.push('        }');
    parts.push("        return (isAbs ? '/' : '') + out.join('/');");
    parts.push('    }');
    parts.push('');
    parts.push('    var __path = {');
    parts.push('        join: function () {');
    parts.push('            var args = Array.prototype.slice.call(arguments);');
    parts.push("            return __normalize(args.join('/'));");
    parts.push('        },');
    parts.push('        dirname: function (p) {');
    parts.push('            var n = __normalize(p);');
    parts.push("            var idx = n.lastIndexOf('/');");
    parts.push("            return idx <= 0 ? '/' : n.substring(0, idx);");
    parts.push('        },');
    parts.push('        basename: function (p) {');
    parts.push('            var n = __normalize(p);');
    parts.push("            var idx = n.lastIndexOf('/');");
    parts.push('            return idx < 0 ? n : n.substring(idx + 1);');
    parts.push('        },');
    parts.push("        sep: '/'");
    parts.push('    };');
    parts.push('');
    parts.push('    function __makeRequire(fromDir) {');
    parts.push('        return function (request) {');
    parts.push("            if (request === 'path') return __path;");
    parts.push('            var resolved;');
    parts.push("            if (request.charAt(0) === '/') {");
    parts.push('                resolved = __normalize(request);');
    parts.push("            } else if (request.charAt(0) === '.') {");
    parts.push("                resolved = __normalize(fromDir + '/' + request);");
    parts.push('            } else {');
    parts.push('                resolved = __normalize(request);');
    parts.push('            }');
    parts.push("            var candidates = [resolved, resolved + '.js', resolved + '/index.js'];");
    parts.push('            for (var i = 0; i < candidates.length; i += 1) {');
    parts.push('                if (__modules[candidates[i]]) return __load(candidates[i]);');
    parts.push('            }');
    parts.push('            throw new Error(');
    parts.push("                'ProctorDistributionV3 bundle: cannot resolve module \"' + request +");
    parts.push("                '\" from \"' + fromDir + '\"'");
    parts.push('            );');
    parts.push('        };');
    parts.push('    }');
    parts.push('');
    parts.push('    function __load(id) {');
    parts.push('        if (__cache[id]) return __cache[id].exports;');
    parts.push('        var def = __modules[id];');
    parts.push("        if (!def) throw new Error('ProctorDistributionV3 bundle: unknown module ' + id);");
    parts.push('        var module = { exports: {}, id: id };');
    parts.push('        __cache[id] = module;');
    parts.push('        var __filename = id;');
    parts.push('        var __dirname = __path.dirname(id);');
    parts.push('        def(module, module.exports, __makeRequire(__dirname), __dirname, __filename);');
    parts.push('        return module.exports;');
    parts.push('    }');
    parts.push('');
    parts.push('    // ----- module definitions -----');
    parts.push('');

    for (const mod of modules) {
        parts.push('    __modules[' + JSON.stringify(mod.id) + '] = function (module, exports, require, __dirname, __filename) {');
        // Source is inlined verbatim as the function body (Node-style). No
        // string escaping is required because it is real code, not a literal.
        parts.push(mod.source.replace(/\r\n/g, '\n').replace(/\s+$/, ''));
        parts.push('    };');
        parts.push('');
    }

    parts.push('    // ----- entry point -----');
    parts.push('    var __entry = __load(' + JSON.stringify(ENTRY_ID) + ');');
    parts.push('    if (global) {');
    parts.push('        global.ProctorDistributionV3 = __entry;');
    parts.push('    }');
    parts.push("})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));");
    parts.push('');

    return parts.join('\n');
}

function main() {
    const bundle = buildBundle();
    fs.writeFileSync(OUT_FILE, bundle, 'utf8');
    const sizeKb = (Buffer.byteLength(bundle, 'utf8') / 1024).toFixed(1);
    // eslint-disable-next-line no-console
    console.log('[build:v3-bundle] wrote ' + path.relative(ROOT, OUT_FILE) + ' (' + sizeKb + ' KB)');
}

main();

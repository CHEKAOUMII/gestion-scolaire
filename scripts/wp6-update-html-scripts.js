'use strict';

/**
 * Ensure every page that loads js/utils.js also loads WP6 shared scripts first:
 *   dom-helpers.js → auth-session.js → filter-manager.js → utils.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = fs.readdirSync(root).filter((f) => f.endsWith('.html'));

const SHARED_BLOCK = [
    '        <script src="js/shared/dom-helpers.js" defer></script>',
    '        <script src="js/shared/auth-session.js" defer></script>',
    '        <script src="js/shared/filter-manager.js" defer></script>',
    '        <script src="js/utils.js" defer></script>'
].join('\n');

// variants of utils script tag indentation
const UTILS_RE =
    /^([ \t]*)<script\s+src=["']js\/utils\.js["']\s+defer\s*>\s*<\/script>\s*$/m;

let updated = 0;
for (const file of files) {
    const full = path.join(root, file);
    let html = fs.readFileSync(full, 'utf8');
    if (!html.includes('js/utils.js')) continue;

    // Already has all three shared scripts before utils
    if (
        html.includes('js/shared/auth-session.js') &&
        html.includes('js/shared/filter-manager.js') &&
        html.includes('js/shared/dom-helpers.js')
    ) {
        // Still normalize order: remove existing shared tags adjacent and re-insert
        // only if utils is present alone with partials
    }

    // Remove any existing shared script tags we manage (avoid duplicates)
    html = html.replace(
        /^[ \t]*<script\s+src=["']js\/shared\/(dom-helpers|auth-session|filter-manager)\.js["']\s+defer\s*>\s*<\/script>\s*\r?\n/gm,
        ''
    );

    if (!UTILS_RE.test(html)) {
        console.warn('utils script tag pattern not found in', file);
        continue;
    }

    html = html.replace(UTILS_RE, SHARED_BLOCK);
    fs.writeFileSync(full, html);
    updated += 1;
    console.log('updated', file);
}

console.log('total updated', updated);

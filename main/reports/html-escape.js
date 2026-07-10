/**
 * Shared HTML escaping for report fragments (CH9).
 * Used by letterhead.js and footer.js — keeps one escaper in main/reports/.
 */
'use strict';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = { esc, escHtml: esc };

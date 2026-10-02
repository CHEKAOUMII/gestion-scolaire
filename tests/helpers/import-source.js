'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const pagePath = path.join(root, 'js', 'pages', 'settings-imports.js');
let cachedPage = null;
let cachedImportCenter = null;

function readPage() {
    if (cachedPage === null) cachedPage = fs.readFileSync(pagePath, 'utf8');
    return cachedPage;
}

function readImportCenter() {
    if (cachedImportCenter !== null) return cachedImportCenter;
    // Collect all js/import-center/**/*.js
    const dir = path.join(root, 'js', 'import-center');
    let combined = '';
    function walk(current) {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.endsWith('.js')) {
                combined += '\n' + fs.readFileSync(full, 'utf8');
            }
        }
    }
    if (fs.existsSync(dir)) walk(dir);
    cachedImportCenter = combined;
    return cachedImportCenter;
}

function importSourceIncludes(needle) {
    if (!needle || typeof needle !== 'string') return false;
    return readPage().includes(needle) || readImportCenter().includes(needle);
}

function importSourceMatches(regex) {
    if (!regex || !(regex instanceof RegExp)) return false;
    return regex.test(readPage()) || regex.test(readImportCenter());
}

function importSourceNotIncludes(needle) {
    return !importSourceIncludes(needle);
}

function getPageSource() {
    return readPage();
}

function getImportCenterSource() {
    return readImportCenter();
}

module.exports = {
    importSourceIncludes,
    importSourceMatches,
    importSourceNotIncludes,
    getPageSource,
    getImportCenterSource,
};

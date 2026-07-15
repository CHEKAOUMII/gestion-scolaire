/**
 * Canonical list of application HTML pages for e2e coverage.
 * Managed pages mirror main/db/managed-pages.js (PAGE_VISIBILITY_CATALOG).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MANAGED_PAGES = require(path.join(ROOT, 'main', 'db', 'managed-pages'));

const AUTH_ENTRY_PAGES = ['setup.html', 'login.html'];

function getAllAppPages() {
    const merged = [...AUTH_ENTRY_PAGES, ...MANAGED_PAGES];
    const unique = [...new Set(merged)];
    return unique.filter((page) => fs.existsSync(path.join(ROOT, page))).sort();
}

module.exports = {
    ROOT,
    AUTH_ENTRY_PAGES,
    MANAGED_PAGES,
    getAllAppPages
};
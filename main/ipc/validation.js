// main/ipc/validation.js
// Shared input validation helpers for IPC handlers.

/**
 * Ensure required fields are present and non-empty.
 * @param {object} data    – the payload object
 * @param {string[]} fields – list of required field names
 * @throws {Error} with descriptive message if any field is missing
 */
function requireFields(data, fields) {
    if (!data || typeof data !== 'object') {
        throw new Error('البيانات المطلوبة غير موجودة');
    }
    const missing = fields.filter((f) => {
        const val = data[f];
        return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
    });
    if (missing.length) {
        throw new Error(`الحقول المطلوبة ناقصة: ${missing.join(', ')}`);
    }
}

/**
 * Validate that a numeric value falls within a given range.
 * @param {string} fieldName  – human-readable field name for errors
 * @param {*} value           – the value to check
 * @param {number} min        – minimum allowed value (inclusive)
 * @param {number} max        – maximum allowed value (inclusive)
 * @throws {Error} if the value is not a number or is outside the range
 */
function validateRange(fieldName, value, min, max) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
        throw new Error(`${fieldName}: يجب أن يكون رقماً`);
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
        throw new Error(`${fieldName}: يجب أن يكون رقماً`);
    }
    if (num < min || num > max) {
        throw new Error(`${fieldName}: يجب أن يكون بين ${min} و ${max}`);
    }
    return num;
}

/**
 * Validate that a value looks like a date string (YYYY-MM-DD or similar).
 * Does NOT enforce strict calendar validity—just basic structure.
 * @param {string} fieldName
 * @param {*} value
 * @throws {Error} if blank or not matching expected format
 */
function validateDate(fieldName, value) {
    const str = String(value || '').trim();
    if (!str) {
        throw new Error(`${fieldName}: التاريخ مطلوب`);
    }
    // Accept YYYY-MM-DD, YYYY/MM/DD
    if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(str)) {
        throw new Error(`${fieldName}: صيغة التاريخ غير صحيحة (YYYY-MM-DD)`);
    }
    return str;
}

/**
 * Validate that a school year string matches the expected YYYY/YYYY pattern.
 * @param {*} value
 * @throws {Error} with code INVALID_SCHOOL_YEAR if the value does not match
 */
function validateSchoolYear(value) {
    const str = String(value || '').trim();
    if (!str) {
        const error = new Error('السنة الدراسية مطلوبة');
        error.code = 'INVALID_SCHOOL_YEAR';
        throw error;
    }
    if (!/^\d{4}\/\d{4}$/.test(str)) {
        const error = new Error(`السنة الدراسية يجب أن تكون بصيغة YYYY/YYYY (مثال: 2024/2025)`);
        error.code = 'INVALID_SCHOOL_YEAR';
        throw error;
    }
    return str;
}

const IPC_MAX_PAGE_SIZE = 500;
const IPC_DEFAULT_PAGE_SIZE = 20;

function normalizePagination(options = {}) {
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    const rawSize = Math.floor(Number(options.pageSize) || IPC_DEFAULT_PAGE_SIZE);
    const pageSize = Math.min(IPC_MAX_PAGE_SIZE, Math.max(1, Number.isFinite(rawSize) ? rawSize : IPC_DEFAULT_PAGE_SIZE));
    return {
        page,
        pageSize,
        offset: (page - 1) * pageSize
    };
}

function buildPaginatedResult(rows, total, page, pageSize) {
    const safeTotal = Math.max(0, Number(total) || 0);
    return {
        rows: rows || [],
        total: safeTotal,
        page,
        pageSize,
        totalPages: safeTotal ? Math.ceil(safeTotal / pageSize) : 1
    };
}

module.exports = {
    requireFields,
    validateRange,
    validateDate,
    validateSchoolYear,
    normalizePagination,
    buildPaginatedResult,
    IPC_MAX_PAGE_SIZE
};

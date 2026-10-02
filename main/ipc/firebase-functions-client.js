'use strict';

// Shared HTTPS client for Firebase Functions HTTP endpoints used by the
// setup/relink/admin identity flows (institution.js, app-admin.js).
//
// Infrastructure failures (App Engine / Cloud Run HTML error pages, empty
// bodies) are logged to the main-process console and surfaced as a single
// friendly SERVER_UNAVAILABLE message — raw response bodies must never leak
// into renderer toasts.

const REQUEST_TIMEOUT_MS = 30_000;

const ERROR_MESSAGES = {
    BOOTSTRAP_TIMEOUT: 'انتهت مهلة الاتصال بالخادم',
    INTERNAL_ERROR: 'حدث خطأ داخلي',
    NOT_FOUND: 'الدالة المطلوبة غير متوفرة على الخادم',
    SERVER_ERROR: 'حدث خطأ على الخادم',
    SERVER_UNAVAILABLE: 'تعذر الاتصال بخادم Firebase حالياً'
};

function fail(code, error) {
    return {
        success: false,
        code,
        error: error || ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR
    };
}

function ok(payload = {}) {
    return { success: true, ...payload };
}

// Known business codes returned by the functions themselves. Anything else is
// treated as an infrastructure failure instead of being shown to the user.
const KNOWN_RAW_CODES = new Set([
    'ALREADY_CONFIGURED',
    'BOOTSTRAP_TIMEOUT',
    'BOOTSTRAP_UNAUTHORIZED',
    'INVALID_ADMIN_NAME',
    'INVALID_MASSAR',
    'INVALID_PASSWORD',
    'MASSAR_AMBIGUOUS',
    'MASSAR_NOT_FOUND'
]);

function mapFailureCode(rawCode) {
    const normalized = String(rawCode || '').trim();
    if (KNOWN_RAW_CODES.has(normalized)) {
        return normalized;
    }
    if (normalized === 'NOT_FOUND') {
        return 'NOT_FOUND';
    }
    return 'SERVER_UNAVAILABLE';
}

async function postFirebaseFunction(functionsUrl, functionName, body) {
    const normalizedUrl = String(functionsUrl || '')
        .trim()
        .replace(/\/+$/, '');
    if (!normalizedUrl) {
        return fail('SERVER_UNAVAILABLE', 'لم يتم ضبط رابط Firebase Functions لهذا الجهاز');
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`${normalizedUrl}/${functionName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: controller.signal
        });
        const text = await response.text();

        let data = null;
        let parseFailed = false;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                parseFailed = true;
            }
        }

        // App Engine / Cloud Run outage pages arrive as HTML regardless of the
        // JSON payload we posted; treat any unparsable body as an outage.
        if (!data || typeof data !== 'object' || parseFailed) {
            console.error(
                `[firebase-functions] ${functionName} returned a non-JSON body (HTTP ${response.status}):`,
                String(text || '').slice(0, 500)
            );
            return fail(
                'SERVER_UNAVAILABLE',
                `تعذر الاتصال بخادم Firebase حالياً (HTTP ${response.status}). حاول مجدداً بعد قليل.`
            );
        }

        if (!response.ok || data.success === false) {
            if (response.status === 404 && functionName === 'bootstrapInstitution') {
                return fail('SERVER_UNAVAILABLE', 'دالة Firebase bootstrapInstitution غير متاحة في الخادم الحالي');
            }
            const mappedCode = mapFailureCode(
                data.code || data.error || (response.status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR')
            );
            return fail(mappedCode, data.message || data.error || ERROR_MESSAGES[mappedCode]);
        }

        return ok({ data });
    } catch (err) {
        if (err.name === 'AbortError') {
            return fail('BOOTSTRAP_TIMEOUT');
        }
        console.error(`[firebase-functions] ${functionName} request failed:`, err.message);
        return fail('SERVER_UNAVAILABLE', 'تعذر الاتصال بـ Firebase Functions: ' + err.message);
    } finally {
        clearTimeout(timeoutTimer);
    }
}

module.exports = { postFirebaseFunction, mapFailureCode };

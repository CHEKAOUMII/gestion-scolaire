const TRANSIENT_HTTP_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'ENOTFOUND',
    'ERR_SOCKET_TIMEOUT',
    'ETIMEDOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT'
]);

function extractStatusCode(err, fallbackMessage = '') {
    const candidates = [err?.statusCode, err?.status, err?.response?.status, err?.response?.statusCode];

    for (const value of candidates) {
        const numericValue = Number(value);
        if (Number.isInteger(numericValue) && numericValue >= 100) {
            return numericValue;
        }
    }

    const statusMatch = String(fallbackMessage || '').match(/\b([1-5]\d{2})\b/);
    return statusMatch ? Number(statusMatch[1]) : null;
}

function isTransientUpdaterError(err) {
    const message = err?.message || String(err || '');
    const statusCode = extractStatusCode(err, message);
    const errorCode = String(err?.code || '').toUpperCase();
    const normalizedMessage = message.toLowerCase();

    if (TRANSIENT_HTTP_STATUS_CODES.has(statusCode)) {
        return true;
    }

    if (TRANSIENT_ERROR_CODES.has(errorCode)) {
        return true;
    }

    return [
        'gateway time-out',
        'gateway timeout',
        'bad gateway',
        'service unavailable',
        'temporarily unavailable',
        'timed out',
        'socket hang up',
        'network error'
    ].some((pattern) => normalizedMessage.includes(pattern));
}

function isAccessUpdaterError(err) {
    const message = err?.message || String(err || '');
    const statusCode = extractStatusCode(err, message);
    const normalizedMessage = message.toLowerCase();

    if ([401, 403, 404].includes(statusCode)) {
        return normalizedMessage.includes('github') || normalizedMessage.includes('releases.atom');
    }

    return false;
}

function getUpdaterErrorMessage(err, options = {}) {
    const interactive = options.interactive !== false;
    const fallbackMessage = err?.message || String(err || 'Unknown update error');

    if (isTransientUpdaterError(err)) {
        return interactive
            ? 'تعذر الوصول مؤقتًا إلى خادم التحديث. حاول مرة أخرى بعد قليل.'
            : 'خادم التحديث غير متاح مؤقتًا، ستتم إعادة المحاولة تلقائيًا.';
    }

    if (isAccessUpdaterError(err)) {
        return 'تعذر الوصول إلى تحديثات GitHub. تحقق من إعدادات الوصول أو من GH_TOKEN.';
    }

    return fallbackMessage;
}

module.exports = {
    getUpdaterErrorMessage,
    isTransientUpdaterError
};

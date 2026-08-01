/**
 * import-readers.js — Bounded read-only extraction for CSV, XLSX, XML.
 *
 * No business-data writes. No readiness mutations.
 * Dual-export: window.ImportReaders + module.exports
 */
(function (root, factory) {
    const api = factory(root);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportReaders = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const MAX_SAMPLE_ROWS = 12;
    const MAX_HEADERS = 80;
    const MAX_XML_ELEMENTS = 40;
    const MAX_TEXT_BYTES = 512 * 1024;

    function extensionOf(name) {
        const n = String(name || '');
        const i = n.lastIndexOf('.');
        return i >= 0 ? n.slice(i + 1).toLowerCase() : '';
    }

    function detectFormat(name, mime) {
        const ext = extensionOf(name);
        const m = String(mime || '').toLowerCase();
        if (ext === 'csv' || m.includes('csv') || m.includes('text/plain')) return 'csv';
        if (ext === 'xlsx' || ext === 'xls' || m.includes('spreadsheet') || m.includes('excel')) return 'xlsx';
        if (ext === 'xml' || m.includes('xml')) return 'xml';
        return 'unknown';
    }

    function parseCsvText(text) {
        const raw = String(text || '');
        if (!raw.trim()) {
            return { headers: [], rows: [], recordEstimate: 0, empty: true };
        }
        const lines = raw.split(/\r?\n/).filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''));
        if (!lines.length) {
            return { headers: [], rows: [], recordEstimate: 0, empty: true };
        }
        const delim = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
        const splitLine = (line) => {
            const cells = [];
            let cur = '';
            let inQ = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    if (inQ && line[i + 1] === '"') {
                        cur += '"';
                        i += 1;
                    } else {
                        inQ = !inQ;
                    }
                } else if (ch === delim && !inQ) {
                    cells.push(cur.trim());
                    cur = '';
                } else {
                    cur += ch;
                }
            }
            cells.push(cur.trim());
            return cells;
        };
        const headers = splitLine(lines[0]).slice(0, MAX_HEADERS);
        const rows = [];
        for (let i = 1; i < lines.length && rows.length < MAX_SAMPLE_ROWS; i++) {
            if (!lines[i].trim()) continue;
            rows.push(splitLine(lines[i]).slice(0, MAX_HEADERS));
        }
        const dataLineCount = lines.slice(1).filter((l) => l.trim()).length;
        return {
            headers,
            rows,
            recordEstimate: dataLineCount,
            empty: headers.length === 0 && dataLineCount === 0
        };
    }

    function extractYearFromText(text) {
        const t = String(text || '');
        // 2025-2026, 2025/2026, 2025_2026
        const m = t.match(/(20\d{2})\s*[-_/]\s*(20\d{2})/);
        if (m) return `${m[1]}-${m[2]}`;
        // compact 20252026
        const c = t.match(/\b(20\d{2})(20\d{2})\b/);
        if (c) return `${c[1]}-${c[2]}`;
        return null;
    }

    function extractTermFromText(text) {
        const t = String(text || '');
        if (/S\s*1|الدورة\s*الأولى|semester\s*1|الأسدس\s*1/i.test(t)) return '1';
        if (/S\s*2|الدورة\s*الثانية|semester\s*2|الأسدس\s*2/i.test(t)) return '2';
        return null;
    }

    /**
     * Parse XML text for root, namespaces, and distinguishing element names.
     */
    function parseXmlText(text) {
        const raw = String(text || '');
        if (!raw.trim()) {
            return {
                xmlRoot: null,
                namespaces: [],
                xmlElements: [],
                empty: true,
                error: 'empty_xml'
            };
        }
        const rootMatch = raw.match(/<([A-Za-z_][\w:.-]*)\b[^>]*>/);
        const xmlRoot = rootMatch ? rootMatch[1].replace(/^.*:/, '') : null;
        if (!xmlRoot) {
            return {
                xmlRoot: null,
                namespaces: [],
                xmlElements: [],
                empty: false,
                error: 'no_root'
            };
        }
        if (/parsererror/i.test(xmlRoot)) {
            return {
                xmlRoot: null,
                namespaces: [],
                xmlElements: [],
                empty: false,
                error: 'parse_error'
            };
        }
        const ns = [];
        const nsRe = /xmlns(?::([A-Za-z_][\w.-]*))?=["']([^"']+)["']/g;
        let nm;
        while ((nm = nsRe.exec(raw)) && ns.length < 10) {
            ns.push(nm[2]);
        }
        const elSet = new Set();
        const elRe = /<([A-Za-z_][\w:.-]*)\b/g;
        let em;
        while ((em = elRe.exec(raw)) && elSet.size < MAX_XML_ELEMENTS) {
            const name = em[1].replace(/^.*:/, '');
            if (name && name !== xmlRoot && name.toLowerCase() !== 'parsererror') {
                elSet.add(name);
            }
        }
        return {
            xmlRoot,
            namespaces: ns,
            xmlElements: Array.from(elSet),
            empty: false,
            error: null
        };
    }

    /**
     * Tokens that signal a real data header row (not a title/meta banner).
     * Used when XLSX exports put titles above the table (Massar absence summaries).
     */
    const HEADER_SIGNAL_TOKENS = Object.freeze([
        'code',
        'massar',
        'cne',
        'رمز',
        'مسار',
        'رقمالتلميذ',
        'رقمالتلميذ',
        'النسب',
        'الاسم',
        'الإسم',
        'fullname',
        'section',
        'القسم',
        'subject',
        'المادة',
        'note',
        'النقطة',
        'grade',
        'absence',
        'غياب',
        'مبرر',
        'غيرمبرر',
        'month',
        'الشهر',
        'status',
        'الوضعية',
        'الترتيب',
        'teacher',
        'الأستاذ',
        'شتنبر',
        'أكتوبر',
        'نونبر',
        'دجنبر',
        'يناير',
        'فبراير',
        'مارس',
        'أبريل',
        'ماي',
        'يونيو'
    ]);

    function normalizeHeaderCell(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u064B-\u065F]/g, '')
            .replace(/[_\s\-./\\:]+/g, '')
            .trim();
    }

    const IDENTITY_HEADER_TOKENS = Object.freeze([
        'code',
        'massar',
        'cne',
        'رمز',
        'مسار',
        'رقمالتلميذ',
        'رقمالتلميذ',
        'النسب',
        'الاسم',
        'الإسم',
        'fullname',
        'الترتيب'
    ]);

    function cellHitsToken(cell, token) {
        const n = normalizeHeaderCell(cell);
        const t = normalizeHeaderCell(token);
        return !!(n && t && (n === t || n.includes(t) || t.includes(n)));
    }

    function isSubHeaderHeavy(cells) {
        const nonEmpty = (cells || []).filter(Boolean);
        if (nonEmpty.length < 4) return false;
        let sub = 0;
        for (const c of nonEmpty) {
            const n = normalizeHeaderCell(c);
            if (
                n.includes('مبرر') ||
                n.includes('justif') ||
                n.includes('hour') ||
                n.includes('ساع') ||
                n.includes('يوم') ||
                n.includes('days')
            ) {
                sub += 1;
            }
        }
        return sub / nonEmpty.length >= 0.6;
    }

    function scoreHeaderRow(cells) {
        const nonEmpty = cells.filter(Boolean);
        if (nonEmpty.length < 2) return -1;

        let score = Math.min(nonEmpty.length, 20) * 0.1;
        let signalHits = 0;
        let identityHits = 0;
        const uniqueNorm = new Set(nonEmpty.map(normalizeHeaderCell).filter(Boolean));

        for (const cell of nonEmpty) {
            let hit = false;
            for (const token of HEADER_SIGNAL_TOKENS) {
                if (cellHitsToken(cell, token)) {
                    signalHits += 1;
                    score += 1.0;
                    hit = true;
                    break;
                }
            }
            for (const token of IDENTITY_HEADER_TOKENS) {
                if (cellHitsToken(cell, token)) {
                    identityHits += 1;
                    score += 2.5;
                    break;
                }
            }
            if (!hit) {
                /* plain text */
            }
        }

        // Prefer diverse labels (real column names) over repeated مبرر/غير مبرر
        const uniqueRatio = uniqueNorm.size / Math.max(nonEmpty.length, 1);
        score += uniqueRatio * 3;
        if (uniqueRatio < 0.25 && nonEmpty.length >= 6) score -= 6;

        // Title-only rows
        if (signalHits === 0 && nonEmpty.length <= 3) score -= 3;
        if (identityHits >= 1) score += 4;
        if (identityHits >= 2) score += 3;
        if (isSubHeaderHeavy(cells) && identityHits === 0) score -= 5;

        return score;
    }

    function mergeHeaderRows(primaryCells, secondaryCells) {
        const width = Math.max(primaryCells.length, secondaryCells.length);
        const merged = [];
        for (let c = 0; c < width && merged.length < MAX_HEADERS; c++) {
            const a = primaryCells[c] || '';
            const b = secondaryCells[c] || '';
            const label = a && b && a !== b ? `${a} ${b}`.trim() : a || b;
            if (label && !merged.includes(label)) merged.push(label);
            else if (label && merged.includes(label)) {
                // keep unique tokens for classification; still count once
            }
        }
        // Also collect unique tokens from both rows for scoring even if columns align poorly
        for (const cell of primaryCells.concat(secondaryCells)) {
            const t = String(cell || '').trim();
            if (t && !merged.includes(t) && merged.length < MAX_HEADERS) merged.push(t);
        }
        return merged.slice(0, MAX_HEADERS);
    }

    /**
     * Pick the best header row within the first scanRows of an AOA sheet.
     * Prefers identity columns over title banners and pure sub-header rows.
     * Merges Massar-style multi-level headers (months + مبرر/غير مبرر [+ أيام/ساعات]).
     */
    function findBestHeaderRow(aoa, scanRows) {
        const limit = Math.min(Array.isArray(aoa) ? aoa.length : 0, scanRows || 30);
        let best = { index: 0, score: -1, headers: [] };

        for (let i = 0; i < limit; i++) {
            const cells = (aoa[i] || []).map((c) => String(c ?? '').trim());
            const score = scoreHeaderRow(cells);
            if (score > best.score) {
                best = { index: i, score, headers: cells };
            }
        }

        if (best.score < 0 && aoa.length) {
            best = {
                index: 0,
                score: 0,
                headers: (aoa[0] || []).map((c) => String(c ?? '').trim())
            };
        }

        let primaryIndex = best.index;
        let primaryCells = best.headers.slice();
        let dataStart = primaryIndex + 1;

        // If we landed on a sub-header-only row, prefer the previous identity row
        if (isSubHeaderHeavy(primaryCells)) {
            for (let back = primaryIndex - 1; back >= Math.max(0, primaryIndex - 3); back--) {
                const prev = (aoa[back] || []).map((c) => String(c ?? '').trim());
                if (scoreHeaderRow(prev) > 0 && !isSubHeaderHeavy(prev)) {
                    primaryIndex = back;
                    primaryCells = prev;
                    break;
                }
            }
        }

        let headers = primaryCells.filter(Boolean).slice(0, MAX_HEADERS);
        let mergedLevels = 0;

        // Merge following sub-header levels (مبرر / أيام-ساعات)
        for (let offset = 1; offset <= 2; offset++) {
            const nextIdx = primaryIndex + offset;
            if (nextIdx >= aoa.length) break;
            const nextCells = (aoa[nextIdx] || []).map((c) => String(c ?? '').trim());
            if (!isSubHeaderHeavy(nextCells) && offset > 1) break;
            if (!isSubHeaderHeavy(nextCells) && offset === 1) {
                // only merge if clearly sub-headers
                const nextSignals = nextCells.filter((c) => {
                    const n = normalizeHeaderCell(c);
                    return n && (n.includes('مبرر') || n.includes('justif') || n.includes('ساع') || n.includes('يوم'));
                }).length;
                if (nextSignals < 2) break;
            }
            headers = mergeHeaderRows(headers, nextCells);
            mergedLevels += 1;
            dataStart = nextIdx + 1;
        }

        // Skip an extra level if data still looks like headers (e.g. الأيام/الساعات)
        while (dataStart < aoa.length && dataStart < primaryIndex + 4) {
            const probe = (aoa[dataStart] || []).map((c) => String(c ?? '').trim());
            if (isSubHeaderHeavy(probe)) {
                headers = mergeHeaderRows(headers, probe);
                dataStart += 1;
                mergedLevels += 1;
            } else {
                break;
            }
        }

        return {
            index: primaryIndex,
            dataStart,
            headers: headers.filter(Boolean).slice(0, MAX_HEADERS),
            subHeaderMerged: mergedLevels > 0
        };
    }

    /**
     * Bounded XLSX extraction using global XLSX or require('xlsx') in Node.
     * @param {ArrayBuffer|Buffer|Uint8Array} data
     */
    function parseXlsxData(data) {
        let XLSXlib = (root && root.XLSX) || null;
        if (!XLSXlib && typeof require === 'function') {
            try {
                XLSXlib = require('xlsx');
            } catch (_e) {
                XLSXlib = null;
            }
        }
        if (!XLSXlib) {
            return {
                error: 'xlsx_unavailable',
                headers: [],
                sheetNames: [],
                rows: [],
                recordEstimate: null
            };
        }
        try {
            const wb = XLSXlib.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer', bookSheets: false });
            const sheetNames = wb.SheetNames || [];
            const headers = [];
            const rows = [];
            let recordEstimate = 0;
            let headerRowIndex = null;
            let metaText = '';
            for (const sheetName of sheetNames.slice(0, 5)) {
                const sheet = wb.Sheets[sheetName];
                if (!sheet) continue;
                const aoa = XLSXlib.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
                if (!aoa.length) continue;
                // Title / institution / year banners above the table
                for (let r = 0; r < Math.min(15, aoa.length); r++) {
                    metaText += ' ' + (aoa[r] || []).map((c) => String(c ?? '').trim()).join(' ');
                }
                const found = findBestHeaderRow(aoa, 30);
                if (headerRowIndex == null) headerRowIndex = found.index;
                for (const h of found.headers) {
                    if (headers.length < MAX_HEADERS && h && !headers.includes(h)) headers.push(h);
                }
                for (let i = found.dataStart; i < aoa.length && rows.length < MAX_SAMPLE_ROWS; i++) {
                    const sample = (aoa[i] || []).map((c) => String(c ?? '').trim());
                    // Skip leftover header-looking rows (e.g. الأيام / الساعات)
                    if (isSubHeaderHeavy(sample)) continue;
                    if (sample.some(Boolean)) rows.push(sample);
                }
                recordEstimate += Math.max(0, aoa.length - found.dataStart);
            }
            const yearFromMeta = extractYearFromText(metaText);
            return {
                error: null,
                headers,
                sheetNames,
                rows,
                recordEstimate,
                headerRowIndex,
                contentText: String(metaText || '').slice(0, 4000),
                detectedYear: yearFromMeta,
                empty: headers.length === 0 && recordEstimate === 0
            };
        } catch (e) {
            return {
                error: 'xlsx_read_failed',
                message: e && e.message,
                headers: [],
                sheetNames: [],
                rows: [],
                recordEstimate: null
            };
        }
    }

    function toBytes(input) {
        if (input instanceof Uint8Array) return input;
        return new Uint8Array(input);
    }

    function stripTextBom(text) {
        return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }

    /**
     * Decode bytes as text without ever guessing (plan §6.3).
     *
     * A BOM is a declared encoding, so UTF-16 LE/BE are honored. Everything else must
     * be valid UTF-8: `fatal: true` makes a mis-encoded file (e.g. Windows-1256 from an
     * older Massar/Excel export) raise `unsupported_encoding` instead of producing
     * mojibake that would then be saved as if it were the student's real name.
     */
    function decodeTextStrict(bytes) {
        if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
            try {
                return new TextDecoder('utf-16le').decode(bytes.subarray(2));
            } catch (_e) {
                throw new Error('unsupported_encoding');
            }
        }
        if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
            try {
                return new TextDecoder('utf-16be').decode(bytes.subarray(2));
            } catch (_e) {
                throw new Error('unsupported_encoding');
            }
        }
        const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        const body = hasUtf8Bom ? bytes.subarray(3) : bytes;
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(body);
        } catch (_e) {
            throw new Error('unsupported_encoding');
        }
    }

    async function readAsText(file) {
        if (!file) throw new Error('no_file');
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
            return decodeTextStrict(toBytes(file)).slice(0, MAX_TEXT_BYTES);
        }
        // Bytes first: File.text() decodes UTF-8 with replacement characters, so it
        // cannot distinguish a valid file from a mis-encoded one.
        if (typeof file.arrayBuffer === 'function') {
            const bytes = toBytes(await file.arrayBuffer());
            return decodeTextStrict(bytes).slice(0, MAX_TEXT_BYTES);
        }
        if (file && typeof file === 'object' && typeof file.content === 'string') {
            return stripTextBom(file.content).slice(0, MAX_TEXT_BYTES);
        }
        if (typeof file.text === 'function') {
            const text = String((await file.text()) || '');
            // U+FFFD means the platform decoder already replaced undecodable bytes.
            if (text.indexOf('�') !== -1) throw new Error('unsupported_encoding');
            return stripTextBom(text).slice(0, MAX_TEXT_BYTES);
        }
        throw new Error('unreadable');
    }

    async function readAsArrayBuffer(file) {
        if (!file) throw new Error('no_file');
        if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
            return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        }
        if (file && file.content != null) {
            const str = String(file.content);
            if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).buffer;
            const buf = Buffer.from(str, 'utf8');
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }
        throw new Error('unreadable');
    }

    /**
     * Extract bounded features from a File-like object.
     * @returns {Promise<object>}
     */
    async function extractFeatures(file, options) {
        const opts = options || {};
        const name = String((file && file.name) || opts.name || 'unknown');
        const size = Number((file && file.size) || opts.size || 0);
        const mime = (file && file.type) || opts.mime || '';
        const format = detectFormat(name, mime);

        const base = {
            filename: name,
            extension: extensionOf(name),
            format,
            size,
            headers: [],
            sheetNames: [],
            sampleRows: [],
            xmlRoot: null,
            namespaces: [],
            xmlElements: [],
            detectedYear: null,
            detectedTerm: null,
            recordEstimate: null,
            contentText: '',
            error: null,
            empty: false
        };

        if (size === 0 && !(file && (file.content || typeof file.text === 'function' || typeof file.arrayBuffer === 'function'))) {
            // allow content-backed test doubles with size 0
        }

        try {
            if (format === 'csv' || format === 'unknown') {
                const text = await readAsText(file);
                if (!text.trim()) {
                    return Object.assign(base, { empty: true, error: 'empty_file', format: format === 'unknown' ? 'csv' : format });
                }
                // Heuristic: if looks like XML
                if (text.trimStart().startsWith('<')) {
                    const xml = parseXmlText(text);
                    return Object.assign(base, {
                        format: 'xml',
                        xmlRoot: xml.xmlRoot,
                        namespaces: xml.namespaces,
                        xmlElements: xml.xmlElements,
                        empty: xml.empty,
                        error: xml.error,
                        detectedYear: extractYearFromText(text),
                        detectedTerm: extractTermFromText(text)
                    });
                }
                const csv = parseCsvText(text);
                const joined = [csv.headers.join(' '), ...csv.rows.map((r) => r.join(' '))].join(' ');
                return Object.assign(base, {
                    format: 'csv',
                    headers: csv.headers,
                    sampleRows: csv.rows,
                    recordEstimate: csv.recordEstimate,
                    contentText: joined.slice(0, 4000),
                    empty: csv.empty,
                    error: csv.empty ? 'empty_file' : null,
                    detectedYear: extractYearFromText(joined),
                    detectedTerm: extractTermFromText(joined)
                });
            }

            if (format === 'xml') {
                const text = await readAsText(file);
                const xml = parseXmlText(text);
                return Object.assign(base, {
                    xmlRoot: xml.xmlRoot,
                    namespaces: xml.namespaces,
                    xmlElements: xml.xmlElements,
                    empty: xml.empty,
                    error: xml.error || (xml.empty ? 'empty_file' : null),
                    detectedYear: extractYearFromText(text),
                    detectedTerm: extractTermFromText(text)
                });
            }

            if (format === 'xlsx') {
                const data = await readAsArrayBuffer(file);
                const x = parseXlsxData(data);
                if (x.error === 'xlsx_unavailable') {
                    // Fallback: try text (some tests pass CSV labeled xlsx)
                    try {
                        const text = await readAsText(file);
                        if (text && !text.includes('\0')) {
                            const csv = parseCsvText(text);
                            return Object.assign(base, {
                                format: 'csv',
                                headers: csv.headers,
                                sampleRows: csv.rows,
                                recordEstimate: csv.recordEstimate,
                                empty: csv.empty,
                                error: csv.empty ? 'empty_file' : null,
                                detectedYear: extractYearFromText(text),
                                detectedTerm: extractTermFromText(text)
                            });
                        }
                    } catch (_e) {
                        /* keep xlsx error */
                    }
                }
                const joined = [x.headers.join(' '), ...(x.rows || []).map((r) => r.join(' '))].join(' ');
                return Object.assign(base, {
                    headers: x.headers || [],
                    sheetNames: x.sheetNames || [],
                    sampleRows: x.rows || [],
                    recordEstimate: x.recordEstimate,
                    headerRowIndex: x.headerRowIndex != null ? x.headerRowIndex : null,
                    contentText: (x.contentText || joined || '').slice(0, 4000),
                    empty: !!x.empty,
                    error: x.error || (x.empty ? 'empty_file' : null),
                    detectedYear: x.detectedYear || extractYearFromText(joined),
                    detectedTerm: extractTermFromText(joined + ' ' + (x.detectedYear || ''))
                });
            }

            return Object.assign(base, { error: 'unsupported_format' });
        } catch (e) {
            // An encoding failure is actionable by the user (re-save as UTF-8), unlike a
            // generic read error — keep the codes distinct so the UI can say which it is.
            const code = e && e.message === 'unsupported_encoding' ? 'unsupported_encoding' : 'unreadable';
            return Object.assign(base, {
                error: code,
                message: e && e.message
            });
        }
    }

    return {
        MAX_SAMPLE_ROWS,
        MAX_HEADERS,
        MAX_XML_ELEMENTS,
        HEADER_SIGNAL_TOKENS,
        detectFormat,
        parseCsvText,
        parseXmlText,
        parseXlsxData,
        findBestHeaderRow,
        normalizeHeaderCell,
        extractFeatures,
        extractYearFromText,
        extractTermFromText,
        extensionOf
    };
});

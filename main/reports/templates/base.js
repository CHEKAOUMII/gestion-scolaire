/**
 * Master document frame — the single template that wraps every official document.
 * Pages provide the body; the engine provides everything else.
 */

/**
 * Assembles the final document HTML from locked components.
 *
 * @param {object} parts
 * @param {string} parts.letterheadHTML  - From letterhead.js
 * @param {string} parts.bodyHTML        - From the page-specific template
 * @param {string} parts.footerHTML      - From footer.js
 * @param {string} [parts.securityHTML]  - From security.js
 * @param {string} [parts.watermarkHTML] - From security.js
 * @param {object} options
 * @param {string} [options.pageSize]    - 'A4' (default)
 * @param {boolean} [options.landscape]
 * @param {string} [options.bodyHeight]  - e.g. '148.5mm' for 2-per-page certificates
 * @param {number} [options.copies]      - Number of copies per page (1 or 2)
 * @returns {string} Complete body HTML for printHTML()
 */
function assembleDocumentBody(parts, options = {}) {
    const { letterheadHTML, bodyHTML, footerHTML, securityHTML, watermarkHTML } = parts;
    const { bodyHeight, copies = 1, landscape = false } = options;

    const heightStyle = bodyHeight ? `height: ${bodyHeight};` : 'min-height: 277mm;';

    const singleDocument = `
    <div class="doc-page" style="
        direction: rtl;
        text-align: right;
        font-family: 'Noto Kufi Arabic', 'IBM Plex Sans Arabic', sans-serif;
        padding: 15mm 15mm 10mm 15mm;
        box-sizing: border-box;
        ${heightStyle}
        display: flex;
        flex-direction: column;
        page-break-inside: avoid;
        position: relative;
        z-index: 1;
    ">
        ${letterheadHTML}
        <div class="doc-body" style="flex: 1;">
            ${bodyHTML}
        </div>
        ${securityHTML || ''}
        ${footerHTML}
    </div>`;

    if (copies === 2) {
        return `
        <div style="
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            background: #fff;
            box-sizing: border-box;
            font-family: 'Noto Kufi Arabic', 'IBM Plex Sans Arabic', sans-serif;
            direction: rtl;
        ">
            ${watermarkHTML || ''}
            ${singleDocument}
            <div style="border-top: 1.5px dashed #aaa; margin: 0 10mm; position: relative;">
                <span style="
                    position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
                    background: #fff; padding: 0 10px; font-size: 8px; color: #bbb;
                    font-family: 'Noto Kufi Arabic', sans-serif;
                ">\u2702 \u062e\u0637 \u0627\u0644\u0642\u0635</span>
            </div>
            ${singleDocument}
        </div>`;
    }

    return `
    <div style="
        width: ${landscape ? '297mm' : '210mm'};
        min-height: ${landscape ? '210mm' : '297mm'};
        margin: 0 auto;
        background: #fff;
        box-sizing: border-box;
    ">
        ${watermarkHTML || ''}
        ${singleDocument}
    </div>`;
}

/**
 * Returns the base inline CSS for all official documents.
 */
function getBaseDocumentStyles(options = {}) {
    const landscape = options.landscape || false;
    const size = landscape ? 'A4 landscape' : 'A4 portrait';

    return `
        @page { size: ${size}; margin: 0; }
        html, body {
            margin: 0; padding: 0;
            width: ${landscape ? '297mm' : '210mm'};
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .doc-letterhead, .doc-footer, .doc-security-bar {
            pointer-events: none;
        }
    `;
}

module.exports = { assembleDocumentBody, getBaseDocumentStyles };

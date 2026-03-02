const { renderLetterhead } = require('./letterhead');
const { renderFooter } = require('./footer');
const { generateSecurityBar, generateDocumentRef, renderWatermark } = require('./security');
const { assembleDocumentBody, getBaseDocumentStyles } = require('./templates/base');
const { printHTML } = require('../print-window');
const { getIdentity } = require('./identity');

/**
 * Assemble and print/export an official document.
 * Single entry point for the entire reporting system.
 *
 * @param {object} payload
 * @param {string} payload.documentType    - 'certificate' | 'semester_report' | 'grade_report' | ...
 * @param {string} payload.documentTitle   - Arabic title shown in letterhead
 * @param {string} payload.bodyHTML        - The page-specific content HTML
 * @param {object} [payload.data]          - Context data for security bar
 * @param {object} [payload.options]       - Print options
 * @returns {Promise<{success: boolean, filePath?: string, ref?: string, error?: string}>}
 */
async function printDocument(payload) {
    const {
        documentType,
        documentTitle,
        bodyHTML,
        data = {},
        options = {}
    } = payload;

    const {
        mode = 'pdf',
        pageSize = 'A4',
        landscape = false,
        copies = 1,
        bodyHeight,
        showSeal = true,
        showSignature = true,
        showSecurity = true,
        showWatermark = false,
        showLetterhead = true,
        showFooter = true,
        defaultFileName
    } = options;

    try {
        // 1. Generate document reference
        const documentRef = generateDocumentRef(documentType);

        // 2. Render locked letterhead
        const letterheadHTML = showLetterhead
            ? renderLetterhead({
                documentTitle,
                documentRef: showSecurity ? documentRef : ''
            })
            : '';

        // 3. Render locked footer
        const footerHTML = showFooter
            ? renderFooter({ showSeal, showSignature })
            : '';

        // 4. Generate security bar (optional)
        let securityHTML = '';
        if (showSecurity) {
            const secBar = generateSecurityBar({
                documentType,
                documentRef,
                studentName: data.studentName || '',
                issuedAt: new Date().toISOString().slice(0, 10)
            });
            securityHTML = secBar.html;
        }

        // 5. Watermark (optional)
        const identity = getIdentity();
        const watermarkHTML = showWatermark
            ? renderWatermark(identity.school_name || '')
            : '';

        // 6. Assemble complete document
        const fullBodyHTML = assembleDocumentBody(
            { letterheadHTML, bodyHTML, footerHTML, securityHTML, watermarkHTML },
            { pageSize, landscape, bodyHeight, copies }
        );

        // 7. Get base CSS
        const inlineStyles = getBaseDocumentStyles({ landscape });

        // 8. Send to existing print engine (skip auto-letterhead — we render our own)
        const result = await printHTML({
            htmlContent: fullBodyHTML,
            inlineStyles,
            title: documentTitle || 'وثيقة رسمية',
            pageSize,
            landscape,
            mode,
            defaultFileName: defaultFileName || `${documentTitle || documentType}_${documentRef}`,
            skipAutoLetterhead: true
        });

        return { ...result, ref: documentRef };
    } catch (err) {
        console.error('[ReportEngine] printDocument failed:', err);
        return { success: false, error: err.message || 'فشل إنشاء الوثيقة' };
    }
}

module.exports = { printDocument };

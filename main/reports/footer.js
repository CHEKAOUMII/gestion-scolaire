const {
    getIdentity,
    getAssetBase64,
    resolveLogoMaxPx,
    SEAL_BASE_PX,
    SIGNATURE_BASE_WIDTH_PX,
    SIGNATURE_BASE_HEIGHT_PX
} = require('./identity');
const { esc } = require('./html-escape');

/**
 * Renders the official, locked footer with seal and signature fields.
 * Assembled server-side — renderer pages never touch this.
 *
 * @param {object} [overrides]
 * @param {string} [overrides.date]          - Formatted date string
 * @param {boolean} [overrides.showSeal]     - Show seal image (default true)
 * @param {boolean} [overrides.showSignature] - Show signature image (default true)
 * @returns {string} HTML
 */
function renderFooter(overrides = {}) {
    const id = getIdentity();
    const seal = getAssetBase64('seal_base64');
    const signature = getAssetBase64('signature_base64');
    const sealPx = resolveLogoMaxPx(id.seal_scale, SEAL_BASE_PX);
    const signatureW = resolveLogoMaxPx(id.signature_scale, SIGNATURE_BASE_WIDTH_PX);
    const signatureH = resolveLogoMaxPx(id.signature_scale, SIGNATURE_BASE_HEIGHT_PX);
    const showSeal = overrides.showSeal !== false;
    const showSignature = overrides.showSignature !== false;
    const dateStr =
        overrides.date ||
        new Date().toLocaleDateString('ar-MA', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

    return `
    <div class="doc-footer" style="
        margin-top: auto;
        padding-top: 12px;
        border-top: 1.5px solid #e0e0e0;
        page-break-inside: avoid;
    ">
        <table style="width: 100%; border-collapse: collapse;" role="presentation">
            <tr>
                <!-- Date + City -->
                <td style="width: 33%; vertical-align: bottom; text-align: right; padding: 0;">
                    <div style="font-size: 10px; color: #555; margin-bottom: 3px;">حُرر بـ:</div>
                    <div style="font-size: 11px; font-weight: 600; color: #222;">
                        ${esc(id.city)}${id.city ? '، ' : ''}في ${esc(dateStr)}
                    </div>
                </td>

                <!-- Official seal -->
                <td style="width: 34%; text-align: center; vertical-align: bottom; padding: 0;">
                    ${
                        showSeal && seal
                            ? `<img src="data:image/png;base64,${seal}"
                             style="max-width: ${sealPx}px; max-height: ${sealPx}px; opacity: 0.85;"
                             alt="ختم المؤسسة">`
                            : showSeal
                              ? `<div style="
                                width: 68px; height: 68px;
                                border: 2px dashed #bbb; border-radius: 50%;
                                margin: 0 auto;
                                display: flex; align-items: center; justify-content: center;
                                font-size: 8px; color: #bbb;
                            ">ختم</div>`
                              : ''
                    }
                </td>

                <!-- Director signature -->
                <td style="width: 33%; text-align: center; vertical-align: bottom; padding: 0;">
                    <div style="font-size: 10px; color: #555; margin-bottom: 4px;">
                        ${esc(id.director_title)}
                    </div>
                    ${
                        showSignature && signature
                            ? `<img src="data:image/png;base64,${signature}"
                             style="max-width: ${signatureW}px; max-height: ${signatureH}px; margin-bottom: 4px;"
                             alt="التوقيع">`
                            : '<div style="height: 32px;"></div>'
                    }
                    <div style="
                        border-top: 1px solid #ccc;
                        padding-top: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        color: #222;
                    ">${esc(id.director_name) || '................................'}</div>
                </td>
            </tr>
        </table>

        <!-- Legal footer text -->
        <div style="
            text-align: center;
            font-size: 8.5px;
            color: #999;
            margin-top: 10px;
            padding-top: 6px;
            border-top: 1px dashed #e5e5e5;
        ">${esc(id.footer_text)}</div>
    </div>`;
}

module.exports = { renderFooter };

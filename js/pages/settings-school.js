const FIELDS = {
    country: 'id-country',
    ministry: 'id-ministry',
    academy: 'id-academy',
    directorate: 'id-directorate',
    school_name: 'id-school-name',
    school_code: 'id-school-code',
    city: 'id-city',
    commune: 'id-commune',
    school_year: 'id-school-year',
    director_name: 'id-director-name',
    director_title: 'id-director-title',
    footer_text: 'id-footer-text'
};

const ASSET_LABELS = {
    logo: 'شعار المؤسسة',
    seal: 'ختم المؤسسة',
    signature: 'توقيع المدير(ة)'
};

let currentLogoBase64 = '';
let currentSealBase64 = '';
let currentSignatureBase64 = '';

function setAssetTriggerState(type, hasAsset) {
    const trigger = document.getElementById(`${type}-preview`);
    if (!trigger) return;
    const label = ASSET_LABELS[type] || 'الصورة';
    const action = hasAsset ? 'تغيير' : 'اختيار';
    const text = `${action} ${label}`;
    trigger.setAttribute('aria-label', text);
    trigger.setAttribute('title', text);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function showAssetPreview(type, base64) {
    const img = document.getElementById(`${type}-img`);
    if (!img) return;
    img.src = `data:image/png;base64,${base64}`;
    img.style.display = 'block';
    document.getElementById(`${type}-placeholder`).style.display = 'none';
    document.getElementById(`btn-remove-${type}`).style.display = '';
    setAssetTriggerState(type, true);
}

function resetAssetPreview(type) {
    document.getElementById(`${type}-img`).style.display = 'none';
    document.getElementById(`${type}-placeholder`).style.display = '';
    document.getElementById(`btn-remove-${type}`).style.display = 'none';
    setAssetTriggerState(type, false);
}

function readAssetFile(file, onLoad) {
    if (!file) return;
    if (file.size > 200 * 1024) {
        showToast('حجم الصورة يتجاوز 200 كيلوبايت', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const base64 = String(reader.result || '').split(',')[1] || '';
        if (!base64) return;
        onLoad(base64);
    };
    reader.readAsDataURL(file);
}

async function loadIdentity() {
    try {
        const identity = await window.api.reports.getIdentity();
        for (const [key, domId] of Object.entries(FIELDS)) {
            const element = document.getElementById(domId);
            if (element && identity[key]) {
                element.value = identity[key];
            }
        }

        if (identity.logo_base64) {
            currentLogoBase64 = identity.logo_base64;
            showAssetPreview('logo', currentLogoBase64);
        }
        if (identity.seal_base64) {
            currentSealBase64 = identity.seal_base64;
            showAssetPreview('seal', currentSealBase64);
        }
        if (identity.signature_base64) {
            currentSignatureBase64 = identity.signature_base64;
            showAssetPreview('signature', currentSignatureBase64);
        }
    } catch {}
}

async function saveIdentity() {
    const updates = {};
    for (const [key, domId] of Object.entries(FIELDS)) {
        updates[key] = document.getElementById(domId).value.trim();
    }

    updates.logo_base64 = currentLogoBase64;
    updates.seal_base64 = currentSealBase64;
    updates.signature_base64 = currentSignatureBase64;

    try {
        await window.api.reports.updateIdentity(updates);

        const legacyPayload = {
            name: updates.school_name,
            code: updates.school_code,
            city: updates.city,
            address: ''
        };
        await window.api.settings.set('school_info', JSON.stringify(legacyPayload));

        showToast('تم حفظ معلومات المؤسسة بنجاح', 'success');
    } catch (err) {
        showToast(`فشل الحفظ: ${err.message || err}`, 'error');
    }
}

function setupAssetUpload(type, setState) {
    const fileInput = document.getElementById(`${type}-file-input`);
    const preview = document.getElementById(`${type}-preview`);
    const uploadButton = document.getElementById(`btn-upload-${type}`);
    const removeButton = document.getElementById(`btn-remove-${type}`);

    uploadButton?.addEventListener('click', () => fileInput?.click());
    preview?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        readAssetFile(file, (base64) => {
            setState(base64);
            showAssetPreview(type, base64);
        });
    });

    removeButton?.addEventListener('click', () => {
        setState('');
        resetAssetPreview(type);
    });
}

function renderLetterheadPreview() {
    const getValue = (id) => document.getElementById(id).value.trim();

    const country = getValue('id-country');
    const ministry = getValue('id-ministry');
    const academy = getValue('id-academy');
    const directorate = getValue('id-directorate');
    const schoolName = getValue('id-school-name');
    const schoolCode = getValue('id-school-code');
    const logo = currentLogoBase64;

    const html = `
        <div class="doc-letterhead" style="border-bottom: 2.5px solid #3B6AC5; padding-bottom: 10px;">
            <table style="width: 100%; border-collapse: collapse;" role="presentation">
                <tr>
                    <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                        <div style="font-size: 13px; font-weight: 700; color: #222;">${escapeHtml(country)}</div>
                        <div style="font-size: 11px; color: #555; margin-top: 2px;">${escapeHtml(ministry)}</div>
                        ${academy ? `<div style="font-size: 10px; color: #666; margin-top: 2px;">${escapeHtml(academy)}</div>` : ''}
                        ${directorate ? `<div style="font-size: 10px; color: #666; margin-top: 1px;">${escapeHtml(directorate)}</div>` : ''}
                    </td>
                    <td style="width: 10%; text-align: center; vertical-align: middle;">
                        ${
                            logo
                                ? `<img src="data:image/png;base64,${logo}" style="max-width: 300px; max-height: 300px;" alt="logo">`
                                : '<div style="width: 52px; height: 52px; border: 1px dashed #ccc; border-radius: 50%; margin: 0 auto;"></div>'
                        }
                    </td>
                    <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                        <div style="font-size: 14px; font-weight: 800; color: #3B6AC5;">${escapeHtml(schoolName)}</div>
                        ${schoolCode ? `<div style="font-size: 10px; color: #888; margin-top: 2px;">رمز المؤسسة: ${escapeHtml(schoolCode)}</div>` : ''}
                    </td>
                </tr>
            </table>
        </div>`;

    document.getElementById('letterhead-preview').innerHTML = html;
    document.getElementById('preview-section').style.display = '';
}

function initSettingsSchoolPage() {
    setAssetTriggerState('logo', false);
    setAssetTriggerState('seal', false);
    setAssetTriggerState('signature', false);

    document.getElementById('btn-save')?.addEventListener('click', saveIdentity);
    document.getElementById('btn-preview')?.addEventListener('click', renderLetterheadPreview);

    setupAssetUpload('logo', (value) => {
        currentLogoBase64 = value;
    });
    setupAssetUpload('seal', (value) => {
        currentSealBase64 = value;
    });
    setupAssetUpload('signature', (value) => {
        currentSignatureBase64 = value;
    });

    loadIdentity();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsSchoolPage);
} else {
    initSettingsSchoolPage();
}

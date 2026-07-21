const MAX_ASSET_BYTES = 200 * 1024;
const DEFAULT_ASSET_SCALE =
    typeof LOGO_SCALE_DEFAULT !== 'undefined' ? LOGO_SCALE_DEFAULT : 100;

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

const ASSET_DEFINITIONS = [
    {
        type: 'logo',
        label: 'شعار المؤسسة',
        sectionIcon: 'fa-image',
        placeholderIcon: 'fa-camera',
        helpText: 'PNG أو JPG — حد أقصى 200 كيلوبايت',
        wide: false,
        scaleable: true,
        scaleKey: 'logo_scale',
        scaleLabel: 'حجم الشعار في الوثائق'
    },
    {
        type: 'seal',
        label: 'ختم المؤسسة',
        sectionIcon: 'fa-stamp',
        placeholderIcon: 'fa-stamp',
        helpText: 'PNG أو JPG — حد أقصى 200 كيلوبايت',
        wide: false,
        scaleable: true,
        scaleKey: 'seal_scale',
        scaleLabel: 'حجم الختم في الوثائق'
    },
    {
        type: 'signature',
        label: 'توقيع المدير(ة)',
        sectionIcon: 'fa-signature',
        placeholderIcon: 'fa-pen-nib',
        helpText: 'PNG أو JPG — حد أقصى 200 كيلوبايت — يُفضّل صورة بخلفية شفافة',
        wide: true,
        scaleable: true,
        scaleKey: 'signature_scale',
        scaleLabel: 'حجم التوقيع في الوثائق'
    }
];

const assets = Object.fromEntries(
    ASSET_DEFINITIONS.map((def) => [
        def.type,
        { base64: '', mime: 'image/png', scale: DEFAULT_ASSET_SCALE }
    ])
);
const assetContainers = new Map();

/** Same clamp used by logo / seal / signature (clampLogoScale). */
function normalizeAssetScale(value) {
    if (typeof clampLogoScale === 'function') return clampLogoScale(value);
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_ASSET_SCALE;
    return Math.min(250, Math.max(30, Math.round(n)));
}

/** Same sizing function as letterhead/footer: resolveLogoMaxPx(scale, basePx?). */
function assetMaxPx(scale, basePx) {
    if (typeof resolveLogoMaxPx === 'function') return resolveLogoMaxPx(scale, basePx);
    const base = Number(basePx);
    const resolvedBase = Number.isFinite(base) && base > 0 ? base : 80;
    return Math.round((resolvedBase * normalizeAssetScale(scale)) / 100);
}

function inferMimeFromBase64(base64) {
    if (!base64) return 'image/png';
    if (base64.startsWith('/9j/')) return 'image/jpeg';
    if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
    return 'image/png';
}

function getAssetDefinition(type) {
    return ASSET_DEFINITIONS.find((def) => def.type === type);
}

function setAssetTriggerLabel(type, hasAsset) {
    const container = assetContainers.get(type);
    if (!container) return;
    const def = getAssetDefinition(type);
    const label = def ? def.label : 'الصورة';
    const text = `${hasAsset ? 'تغيير' : 'اختيار'} ${label}`;
    const trigger = container.querySelector('.asset-preview');
    if (!trigger) return;
    trigger.setAttribute('aria-label', text);
    trigger.setAttribute('title', text);
}

function setScaleControlVisible(type, visible) {
    const container = assetContainers.get(type);
    if (!container) return;
    const scaleControl = container.querySelector('.asset-scale-control');
    if (!scaleControl) return;
    const def = getAssetDefinition(type);
    scaleControl.hidden = !(def?.scaleable && visible);
}

function setScaleControlValue(type, scale) {
    const container = assetContainers.get(type);
    if (!container) return;
    const slider = container.querySelector('.asset-scale-slider');
    const valueLabel = container.querySelector('.asset-scale-value');
    const normalized = normalizeAssetScale(scale);
    if (slider) slider.value = String(normalized);
    if (valueLabel) valueLabel.textContent = `${normalized}%`;
}

function showAssetPreview(type, base64, mime) {
    const container = assetContainers.get(type);
    if (!container) return;
    const img = container.querySelector('.asset-img');
    const placeholder = container.querySelector('.asset-placeholder-icon');
    const removeBtn = container.querySelector('.asset-remove-btn');
    if (!img || !placeholder || !removeBtn) return;
    const resolvedMime = mime || inferMimeFromBase64(base64);
    img.src = `data:${resolvedMime};base64,${base64}`;
    img.hidden = false;
    placeholder.hidden = true;
    removeBtn.hidden = false;
    setAssetTriggerLabel(type, true);
    setScaleControlVisible(type, true);
}

function resetAssetPreview(type) {
    const container = assetContainers.get(type);
    if (!container) return;
    const img = container.querySelector('.asset-img');
    const placeholder = container.querySelector('.asset-placeholder-icon');
    const removeBtn = container.querySelector('.asset-remove-btn');
    if (!img || !placeholder || !removeBtn) return;
    img.removeAttribute('src');
    img.hidden = true;
    placeholder.hidden = false;
    removeBtn.hidden = true;
    setAssetTriggerLabel(type, false);
    setScaleControlVisible(type, false);
}

function readAssetFile(file, onLoad) {
    if (!file) return;
    if (file.size > MAX_ASSET_BYTES) {
        showToast('حجم الصورة يتجاوز 200 كيلوبايت', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
        if (!match) return;
        const [, mime, base64] = match;
        if (!base64) return;
        onLoad(base64, mime || file.type || 'image/png');
    };
    reader.onerror = () => {
        console.warn('settings-school: failed to read asset file', reader.error);
        showToast('تعذر قراءة الملف', 'error');
    };
    reader.readAsDataURL(file);
}

function renderAssetUploaders() {
    const tpl = document.getElementById('asset-uploader-template');
    const row = document.getElementById('assets-row');
    if (!tpl || !row) return;

    for (const def of ASSET_DEFINITIONS) {
        const node = tpl.content.firstElementChild.cloneNode(true);
        node.dataset.assetType = def.type;

        const titleId = `asset-${def.type}-title`;
        node.setAttribute('aria-labelledby', titleId);

        const titleWrap = node.querySelector('.section-title');
        if (titleWrap) titleWrap.id = titleId;

        const sectionIcon = node.querySelector('.asset-section-icon');
        if (sectionIcon) sectionIcon.classList.add(def.sectionIcon);

        const titleSpan = node.querySelector('.asset-section-title');
        if (titleSpan) titleSpan.textContent = def.label;

        const placeholderIcon = node.querySelector('.asset-placeholder-icon');
        if (placeholderIcon) placeholderIcon.classList.add(def.placeholderIcon);

        const fileInputId = `asset-${def.type}-file-input`;
        const preview = node.querySelector('.asset-preview');
        if (preview) {
            if (def.wide) preview.classList.add('is-signature');
            preview.setAttribute('aria-controls', fileInputId);
        }

        const fileInput = node.querySelector('.asset-file-input');
        if (fileInput) {
            fileInput.id = fileInputId;
            fileInput.name = `${def.type}_file`;
        }

        const img = node.querySelector('.asset-img');
        if (img) img.alt = def.label;

        const helpText = node.querySelector('.asset-help-text');
        if (helpText) helpText.textContent = def.helpText;

        const removeLabel = node.querySelector('.asset-remove-label');
        if (removeLabel) removeLabel.textContent = `حذف ${def.label}`;

        if (def.scaleable) {
            const scaleText = node.querySelector('.asset-scale-text');
            if (scaleText) scaleText.textContent = def.scaleLabel || 'حجم الصورة في الوثائق';
            const scaleSlider = node.querySelector('.asset-scale-slider');
            if (scaleSlider) {
                scaleSlider.setAttribute('aria-label', def.scaleLabel || `نسبة حجم ${def.label}`);
            }
        }

        assetContainers.set(def.type, node);
        row.appendChild(node);

        wireAssetUploader(def.type, node);
        setAssetTriggerLabel(def.type, false);
    }
}

function wireAssetUploader(type, container) {
    const fileInput = container.querySelector('.asset-file-input');
    const preview = container.querySelector('.asset-preview');
    const uploadBtn = container.querySelector('.asset-upload-btn');
    const removeBtn = container.querySelector('.asset-remove-btn');
    const scaleSlider = container.querySelector('.asset-scale-slider');
    const def = getAssetDefinition(type);

    const openPicker = () => fileInput?.click();
    uploadBtn?.addEventListener('click', openPicker);
    preview?.addEventListener('click', openPicker);

    fileInput?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        readAssetFile(file, (base64, mime) => {
            const prevScale = assets[type]?.scale ?? DEFAULT_ASSET_SCALE;
            assets[type] = { base64, mime, scale: prevScale };
            showAssetPreview(type, base64, mime);
        });
        if (event.target) event.target.value = '';
    });

    removeBtn?.addEventListener('click', () => {
        assets[type] = {
            base64: '',
            mime: 'image/png',
            scale: assets[type]?.scale ?? DEFAULT_ASSET_SCALE
        };
        resetAssetPreview(type);
    });

    if (def?.scaleable && scaleSlider) {
        scaleSlider.addEventListener('input', () => {
            const scale = normalizeAssetScale(scaleSlider.value);
            assets[type].scale = scale;
            setScaleControlValue(type, scale);
            // Live-refresh letterhead preview if it is already open
            const previewSection = document.getElementById('preview-section');
            if (previewSection && !previewSection.hidden) {
                renderLetterheadPreview();
            }
        });
        setScaleControlValue(type, assets[type].scale);
        setScaleControlVisible(type, false);
    }
}

/**
 * Fill the academy <select> with MA_ACADEMIES options. If a previously-stored value doesn't
 * match any option (free-text institutions from before this dropdown existed — Part 3
 * backward compatibility), a temporary option carrying that exact value is appended and
 * selected so the stored data is never silently dropped.
 * @param {string} selectedValue - stored academy value (may be '' or a non-matching string)
 */
function populateAcademyDropdown(selectedValue) {
    const select = document.getElementById(FIELDS.academy);
    if (!select || typeof MA_ACADEMIES === 'undefined') return;

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = 'اختر الأكاديمية الجهوية';
    placeholder.selected = !selectedValue;
    select.appendChild(placeholder);

    let matched = false;
    for (const academy of MA_ACADEMIES) {
        const option = document.createElement('option');
        option.value = academy;
        option.textContent = academy;
        if (selectedValue && academy === selectedValue) {
            option.selected = true;
            matched = true;
        }
        select.appendChild(option);
    }

    if (selectedValue && !matched) {
        console.warn('settings-school: stored academy value has no matching dropdown option, keeping as-is:', selectedValue);
        const fallbackOption = document.createElement('option');
        fallbackOption.value = selectedValue;
        fallbackOption.textContent = selectedValue;
        fallbackOption.selected = true;
        select.appendChild(fallbackOption);
    }
}

/**
 * Fill the directorate <select> with the MA_DIRECTORATES entries for the given academy
 * (cascading behavior). Disabled with a placeholder when no academy is selected. Same
 * non-matching-value fallback as populateAcademyDropdown for backward compatibility.
 * @param {string} academyValue - currently selected academy (may be '')
 * @param {string} selectedValue - stored directorate value (may be '' or non-matching)
 */
function populateDirectorateDropdown(academyValue, selectedValue) {
    const select = document.getElementById(FIELDS.directorate);
    if (!select) return;

    if (!academyValue) {
        select.innerHTML = '<option value="" disabled selected>اختر الأكاديمية أولاً</option>';
        select.disabled = true;
        return;
    }

    select.disabled = false;
    const directorates = (typeof MA_DIRECTORATES !== 'undefined' && MA_DIRECTORATES[academyValue]) || [];

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = 'اختر المديرية الإقليمية';
    placeholder.selected = !selectedValue;
    select.appendChild(placeholder);

    let matched = false;
    for (const directorate of directorates) {
        const option = document.createElement('option');
        option.value = directorate;
        option.textContent = directorate;
        if (selectedValue && directorate === selectedValue) {
            option.selected = true;
            matched = true;
        }
        select.appendChild(option);
    }

    if (selectedValue && !matched) {
        console.warn(
            'settings-school: stored directorate value has no matching dropdown option for this academy, keeping as-is:',
            selectedValue
        );
        const fallbackOption = document.createElement('option');
        fallbackOption.value = selectedValue;
        fallbackOption.textContent = selectedValue;
        fallbackOption.selected = true;
        select.appendChild(fallbackOption);
    }
}

/** Wires the academy -> directorate cascade: changing academy resets directorate options. */
function wireAcademyDirectorateCascade() {
    const academySelect = document.getElementById(FIELDS.academy);
    academySelect?.addEventListener('change', (event) => {
        populateDirectorateDropdown(event.target.value, '');
    });
}

async function loadIdentity() {
    try {
        const identity = await window.api.reports.getIdentity();
        for (const [key, domId] of Object.entries(FIELDS)) {
            if (key === 'academy' || key === 'directorate') continue; // handled below
            const element = document.getElementById(domId);
            if (element && identity[key]) {
                element.value = identity[key];
            }
        }

        populateAcademyDropdown(identity.academy);
        populateDirectorateDropdown(identity.academy, identity.directorate);

        for (const def of ASSET_DEFINITIONS) {
            const stored = identity[`${def.type}_base64`];
            const scale = def.scaleable
                ? normalizeAssetScale(identity[def.scaleKey] ?? DEFAULT_ASSET_SCALE)
                : DEFAULT_ASSET_SCALE;
            assets[def.type] = {
                base64: stored || '',
                mime: stored ? inferMimeFromBase64(stored) : 'image/png',
                scale
            };
            if (def.scaleable) setScaleControlValue(def.type, scale);
            if (stored) {
                showAssetPreview(def.type, stored, assets[def.type].mime);
            }
        }
    } catch (err) {
        console.warn('settings-school: failed to load identity', err);
    }
}

async function saveIdentity() {
    const updates = {};
    for (const [key, domId] of Object.entries(FIELDS)) {
        const element = document.getElementById(domId);
        updates[key] = element ? element.value.trim() : '';
    }

    for (const def of ASSET_DEFINITIONS) {
        updates[`${def.type}_base64`] = assets[def.type].base64;
        if (def.scaleable && def.scaleKey) {
            updates[def.scaleKey] = String(
                normalizeAssetScale(assets[def.type].scale ?? DEFAULT_ASSET_SCALE)
            );
        }
    }

    try {
        await window.api.reports.updateIdentity(updates);

        // Legacy mirror: `mergeLegacyFallbacks` in main/reports/identity.js still
        // reads the `school_info` settings row as a fallback for older databases.
        const legacyPayload = {
            name: updates.school_name,
            code: updates.school_code,
            city: updates.city,
            address: ''
        };
        await window.api.settings.set('school_info', JSON.stringify(legacyPayload));

        showToast('تم حفظ معلومات المؤسسة بنجاح', 'success');
    } catch (err) {
        console.warn('settings-school: failed to save identity', err);
        showToast(`فشل الحفظ: ${err.message || err}`, 'error');
    }
}

function renderLetterheadPreview() {
    const getValue = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    const country = getValue('id-country');
    const ministry = getValue('id-ministry');
    const academy = getValue('id-academy');
    const directorate = getValue('id-directorate');
    const schoolName = getValue('id-school-name');
    const schoolCode = getValue('id-school-code');
    const commune = getValue('id-commune');
    const schoolYear = getValue('id-school-year');
    const { base64: logo, mime: logoMime, scale: logoScale } = assets.logo;
    const logoPx = assetMaxPx(logoScale);

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
                                ? `<img src="data:${logoMime};base64,${logo}" style="max-width: ${logoPx}px; max-height: ${logoPx}px;" alt="logo">`
                                : '<div style="width: 52px; height: 52px; border: 1px dashed #ccc; border-radius: 50%; margin: 0 auto;"></div>'
                        }
                    </td>
                    <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                        <div style="font-size: 14px; font-weight: 800; color: #3B6AC5;">${escapeHtml(schoolName)}</div>
                        ${schoolCode ? `<div style="font-size: 10px; color: #888; margin-top: 2px;">رمز المؤسسة: ${escapeHtml(schoolCode)}</div>` : ''}
                        ${commune ? `<div style="font-size: 10px; color: #888; margin-top: 2px;">الجماعة: ${escapeHtml(commune)}</div>` : ''}
                        ${schoolYear ? `<div style="font-size: 10px; color: #888; margin-top: 2px;">السنة الدراسية: ${escapeHtml(schoolYear)}</div>` : ''}
                    </td>
                </tr>
            </table>
        </div>`;

    const previewHost = document.getElementById('letterhead-preview');
    const previewSection = document.getElementById('preview-section');
    if (previewHost) previewHost.innerHTML = html;
    if (previewSection) previewSection.hidden = false;
}

async function loadSyncInstitutionSection() {
    try {
        if (!window.api?.institution?.getStatus) return;
        const status = await window.api.institution.getStatus();
        if (!status?.setupCompleted) return;

        const section = document.getElementById('sync-institution-section');
        const codeInput = document.getElementById('sync-inst-code');
        const nameInput = document.getElementById('sync-inst-name');
        if (!section) return;

        if (codeInput) codeInput.value = status.massarCode || '';
        if (nameInput) nameInput.value = status.institutionName || '';
        section.hidden = false;

        const linkWrap = document.getElementById('sync-inst-link-wrap');
        const saveBtn = document.getElementById('sync-inst-save-btn');
        let isPrincipalOrDeveloper = false;
        try {
            const raw = localStorage.getItem('gsl_auth_session_v1');
            const sess = raw ? JSON.parse(raw) : null;
            const role = String(sess?.role || '').toLowerCase();
            isPrincipalOrDeveloper = role === 'principal' || role === 'developer';
        } catch (err) {
            console.warn('settings-school: failed to inspect auth session', err);
        }

        if (codeInput) codeInput.disabled = !isPrincipalOrDeveloper;
        if (linkWrap && isPrincipalOrDeveloper) linkWrap.hidden = false;

        if (saveBtn && !saveBtn.dataset.wired) {
            saveBtn.dataset.wired = '1';
            saveBtn.addEventListener('click', async () => {
                const errorEl = document.getElementById('sync-inst-code-error');
                if (errorEl) {
                    errorEl.textContent = '';
                    errorEl.classList.add('hidden');
                }

                const massarCode = String(codeInput?.value || '').trim().toUpperCase();
                if (codeInput) codeInput.value = massarCode;

                if (!massarCode) {
                    if (errorEl) {
                        errorEl.textContent = 'رمز ماسار مطلوب';
                        errorEl.classList.remove('hidden');
                    }
                    return;
                }
                if (massarCode.length > 20 || !/^[A-Z0-9]+$/.test(massarCode)) {
                    if (errorEl) {
                        errorEl.textContent = 'رمز ماسار غير صالح - يجب أن يتكون من حروف إنجليزية كبيرة وأرقام فقط، بحد أقصى 20 حرفاً';
                        errorEl.classList.remove('hidden');
                    }
                    return;
                }

                saveBtn.disabled = true;
                const originalHtml = saveBtn.innerHTML;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> جارٍ الحفظ...';

                try {
                    const result = await window.api.institution.updateMassarCode({ massarCode });
                    if (result?.success) {
                        showToast(result.message || 'تم تحديث رمز المؤسسة بنجاح', 'success');
                    } else {
                        showToast(result?.error || 'تعذر تحديث رمز المؤسسة', 'error');
                    }
                } catch (err) {
                    console.error('settings-school: updateMassarCode failed', err);
                    showToast('حدث خطأ غير متوقع أثناء تحديث رمز المؤسسة', 'error');
                } finally {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = originalHtml;
                }
            });
        }
    } catch (err) {
        console.warn('settings-school: failed to load sync institution status', err);
    }
}

function initSettingsSchoolPage() {
    renderAssetUploaders();
    wireAcademyDirectorateCascade();

    const form = document.getElementById('school-form');
    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        saveIdentity();
    });

    document.getElementById('btn-preview')?.addEventListener('click', renderLetterheadPreview);

    loadIdentity();
    loadSyncInstitutionSection();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsSchoolPage);
} else {
    initSettingsSchoolPage();
}

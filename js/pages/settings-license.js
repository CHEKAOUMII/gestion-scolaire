            function el(id) {
                return document.getElementById(id);
            }

            function esc(value) {
                const div = document.createElement('div');
                div.textContent = value == null ? '' : String(value);
                return div.innerHTML;
            }

            function fmtDate(value) {
                if (!value) return '-';
                const d = new Date(value);
                if (Number.isNaN(d.getTime())) return '-';
                return d.toLocaleString('ar-MA', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }

            function statusLabel(status) {
                const labels = {
                    not_activated: 'غير مفعل',
                    active: 'نشط',
                    grace_warning: 'نشط (قرب انتهاء المهلة)',
                    grace_expired: 'المهلة منتهية',
                    expired: 'منتهي',
                    suspended: 'موقوف',
                    inactive: 'غير نشط',
                    revoked: 'ملغى',
                    device_not_activated: 'الجهاز غير مفعل'
                };
                return labels[status] || status || '-';
            }

            function renderStatus(status) {
                el('status-value').textContent = statusLabel(status?.status);
                el('plan-value').textContent = (status?.planName || status?.planCode || '-').toUpperCase();
                el('devices-value').textContent =
                    `${Number(status?.activeDevices || 0)} / ${Number(status?.maxDevices || 0)}`;
                el('expiry-value').textContent = fmtDate(status?.expiresAt);
                el('validated-value').textContent = fmtDate(status?.lastValidatedAt);

                if (status?.requiresOnlineValidation) {
                    const days = Number(status?.graceRemainingDays || 0);
                    el('grace-value').textContent = `${days} يوم`;
                } else {
                    el('grace-value').textContent = 'غير مطلوب';
                }

                const hasActivation = status?.status !== 'not_activated';
                el('deactivate-btn').disabled = !hasActivation;
                el('revalidate-btn').disabled = !hasActivation;
            }

            function renderDevices(devices) {
                const tbody = el('devices-tbody');
                if (!Array.isArray(devices) || !devices.length) {
                    tbody.innerHTML = '<tr><td class="px-5 py-5 text-center" colspan="7">لا توجد أجهزة مفعلة</td></tr>';
                    return;
                }

                tbody.innerHTML = devices
                    .map(
                        (device, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${esc(device.deviceName || '-')}</td>
                    <td>${esc(device.platform || '-')}</td>
                    <td>${esc(fmtDate(device.lastSeenAt))}</td>
                    <td>${device.isCurrentDevice ? '<span class="font-bold text-[var(--color-success-text)]">نعم</span>' : '-'}</td>
                    <td>${Number(device.matchScore || 0)}%</td>
                    <td>
                        <button
                            type="button"
                            class="btn btn-sm btn-danger"
                            data-action="admin-revoke"
                            data-device-id="${Number(device.id || 0)}"
                        >
                            تعطيل
                        </button>
                    </td>
                </tr>
            `
                    )
                    .join('');
            }

            async function onAdminRevokeDevice(activationId) {
                const id = Number(activationId);
                if (!Number.isInteger(id) || id <= 0) return;

                if (!confirm('هل تريد تعطيل هذا الجهاز من الترخيص؟')) return;

                const res = await window.api.licensing.adminRevokeDevice({ activationId: id });
                if (!res?.success) {
                    showToast(res?.error || 'تعذر تعطيل الجهاز', 'error');
                    return;
                }

                showToast('تم تعطيل الجهاز بنجاح', 'success');
                await loadData();
            }

            async function loadData() {
                try {
                    const statusRes = await window.api.licensing.getStatus();
                    if (!statusRes?.success) {
                        throw new Error(statusRes?.error || 'تعذر تحميل حالة الترخيص');
                    }

                    const devicesRes = await window.api.licensing.listDevices();
                    renderStatus(statusRes);
                    renderDevices(devicesRes?.devices || []);
                } catch (err) {
                    showToast(err?.message || 'حدث خطأ أثناء تحميل الترخيص', 'error');
                }
            }

            async function onActivate(event) {
                event.preventDefault();
                const licenseKey = el('license-key').value.trim();
                const deviceName = el('device-name').value.trim();
                if (!licenseKey) return;

                const res = await window.api.licensing.activate({ licenseKey, deviceName });
                if (!res?.success) {
                    showToast(res?.error || 'فشل تفعيل المفتاح', 'error');
                    return;
                }

                showToast('تم تفعيل الترخيص بنجاح', 'success');
                el('license-key').value = '';
                await loadData();
            }

            async function onDeactivateCurrent() {
                const res = await window.api.licensing.deactivateCurrentDevice();
                if (!res?.success) {
                    showToast(res?.error || 'تعذر تعطيل الجهاز', 'error');
                    return;
                }
                showToast('تم تعطيل الجهاز الحالي', 'success');
                await loadData();
            }

            async function onRefreshValidation() {
                const res = await window.api.licensing.refreshValidation();
                if (!res?.success) {
                    showToast(res?.error || 'تعذر تحديث التحقق', 'error');
                    return;
                }
                showToast('تم تحديث حالة التحقق', 'success');
                await loadData();
            }

            async function onGenerateSerial(event) {
                event.preventDefault();

                const payload = {
                    planCode: el('serial-plan').value,
                    days: Number(el('serial-days').value || 365),
                    customerRef: el('serial-customer').value.trim(),
                    deviceCode: el('serial-device-code').value.trim().toLowerCase(),
                    requiresOnlineValidation: el('serial-online').checked
                };

                const res = await window.api.licensing.generateSerial(payload);
                if (!res?.success) {
                    showToast(res?.error || 'تعذر توليد السيريال', 'error');
                    return;
                }

                el('serial-output').value = res.serialKey || '';
                showToast('تم توليد السيريال بنجاح', 'success');
            }

            async function copySerialOutput() {
                const value = el('serial-output').value.trim();
                if (!value) return;
                try {
                    await navigator.clipboard.writeText(value);
                    showToast('تم نسخ السيريال', 'success');
                } catch (_err) {
                    el('serial-output').select();
                    document.execCommand('copy');
                    showToast('تم نسخ السيريال', 'success');
                }
            }

            function renderOwnerDevices(devices) {
                const tbody = el('owner-devices-tbody');
                if (!Array.isArray(devices) || !devices.length) {
                    tbody.innerHTML = '<tr><td class="px-4 py-4 text-center" colspan="5">لا توجد بيانات بعد</td></tr>';
                    return;
                }

                tbody.innerHTML = devices
                    .map(
                        (device) => `
                <tr>
                    <td>${esc(device.deviceName || device.deviceCode || '-')}</td>
                    <td>${esc(device.platform || '-')}</td>
                    <td>${esc((device.planCode || '-').toUpperCase())}</td>
                    <td>${device.activated ? 'مفعّل' : 'غير مفعّل'}</td>
                    <td>${esc(fmtDate(device.lastSeenAt))}</td>
                </tr>
            `
                    )
                    .join('');
            }

            function applyOwnerSyncConfig(cfg = {}) {
                el('owner-sync-url').value = cfg.serverUrl || '';
                el('owner-sync-heartbeat').value = Number(cfg.heartbeatIntervalMinutes || 360);
                el('owner-sync-enabled').checked = !!cfg.enabled;
            }

            function buildOwnerSyncTokenPayload() {
                const payload = {};
                const writeToken = el('owner-sync-write-token').value.trim();
                const readToken = el('owner-sync-read-token').value.trim();

                // Leave token values out unless the admin explicitly typed them.
                if (writeToken) payload.writeToken = writeToken;
                if (readToken) payload.readToken = readToken;
                return payload;
            }

            async function loadOwnerSyncConfig() {
                if (!window.api?.ownerTelemetry?.getConfig) return;
                const res = await window.api.ownerTelemetry.getConfig();
                if (!res?.success) {
                    // Silently skip auth / config-missing errors — fields stay at defaults
                    if (
                        res?.code !== 'UNAUTHENTICATED' &&
                        res?.code !== 'FORBIDDEN' &&
                        res?.code !== 'OWNER_SYNC_CONFIG_MISSING'
                    ) {
                        showToast(res?.error || 'تعذر تحميل إعدادات المزامنة', 'error');
                    }
                    return;
                }

                applyOwnerSyncConfig(res.config || {});
            }

            async function loadOwnerTelemetryOverview() {
                if (!window.api?.ownerTelemetry?.getOverview) return;

                const overviewRes = await window.api.ownerTelemetry.getOverview();
                if (!overviewRes?.success) {
                    el('owner-total-devices').textContent = '0';
                    el('owner-active-24h').textContent = '0';
                    el('owner-activated-devices').textContent = '0';
                    renderOwnerDevices([]);
                    // Show toast only for unexpected errors, not for missing config or auth
                    if (
                        overviewRes?.code !== 'OWNER_SYNC_CONFIG_MISSING' &&
                        overviewRes?.code !== 'UNAUTHENTICATED' &&
                        overviewRes?.code !== 'FORBIDDEN'
                    ) {
                        showToast(overviewRes?.error || 'تعذر تحميل بيانات المزامنة', 'error');
                    }
                    return;
                }

                const summary = overviewRes.summary || {};
                el('owner-total-devices').textContent = Number(summary.totalDevices || 0);
                el('owner-active-24h').textContent = Number(summary.active24h || 0);
                el('owner-activated-devices').textContent = Number(summary.activatedDevices || 0);

                const devicesRes = await window.api.ownerTelemetry.getDevices({ limit: 50 });
                renderOwnerDevices(devicesRes?.success ? devicesRes.devices : []);
            }

            async function onSaveOwnerSyncConfig(event) {
                event.preventDefault();
                if (!window.api?.ownerTelemetry?.saveConfig) return;

                const payload = {
                    serverUrl: el('owner-sync-url').value.trim(),
                    heartbeatIntervalMinutes: Number(el('owner-sync-heartbeat').value || 360),
                    enabled: el('owner-sync-enabled').checked,
                    ...buildOwnerSyncTokenPayload()
                };

                const res = await window.api.ownerTelemetry.saveConfig(payload);
                if (!res?.success) {
                    showToast(res?.error || 'تعذر حفظ إعدادات المزامنة', 'error');
                    return;
                }

                showToast('تم حفظ إعدادات المزامنة', 'success');
                await loadOwnerSyncConfig();
                await loadOwnerTelemetryOverview();
            }

            async function onTestOwnerSyncConnection() {
                if (!window.api?.ownerTelemetry?.testConnection) return;

                const payload = {
                    serverUrl: el('owner-sync-url').value.trim(),
                    ...buildOwnerSyncTokenPayload()
                };

                const res = await window.api.ownerTelemetry.testConnection(payload);
                if (!res?.success) {
                    showToast(res?.error || 'فشل اختبار الاتصال', 'error');
                    return;
                }

                showToast('اختبار الاتصال ناجح (الخادم + write token + read token)', 'success');
            }

            async function onOwnerSyncNow() {
                if (!window.api?.ownerTelemetry?.syncNow) return;

                const res = await window.api.ownerTelemetry.syncNow();
                if (!res?.success) {
                    showToast(res?.error || 'فشلت مزامنة الأجهزة', 'error');
                    return;
                }

                showToast(`تمت المزامنة (مرسلة: ${Number(res.sentCount || 0)})`, 'success');
                await loadOwnerTelemetryOverview();
            }

            document.addEventListener('DOMContentLoaded', async () => {
                el('activate-form').addEventListener('submit', onActivate);
                el('serial-form').addEventListener('submit', onGenerateSerial);
                el('owner-sync-form').addEventListener('submit', onSaveOwnerSyncConfig);
                el('refresh-btn').addEventListener('click', loadData);
                el('deactivate-btn').addEventListener('click', onDeactivateCurrent);
                el('revalidate-btn').addEventListener('click', onRefreshValidation);
                el('copy-serial-btn').addEventListener('click', copySerialOutput);
                el('owner-sync-test').addEventListener('click', onTestOwnerSyncConnection);
                el('owner-sync-now').addEventListener('click', onOwnerSyncNow);
                el('devices-tbody').addEventListener('click', (event) => {
                    const button = event.target.closest('button[data-action="admin-revoke"]');
                    if (!button) return;
                    void onAdminRevokeDevice(button.dataset.deviceId);
                });
                await loadOwnerSyncConfig();
                await loadData();
                await loadOwnerTelemetryOverview();
            });
        
function showSetupToast(message, type) {
    console.log(`[SETUP-TOAST] [${type}] ${message}`);

    // Visual fallback: create a floating toast if showToast is unavailable
    if (typeof showToast === 'function') {
        showToast(message, type);
        return;
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        z-index: 99999; padding: 14px 28px; border-radius: 10px;
        font-size: 14px; font-weight: 500; color: #fff; max-width: 90%;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3); text-align: center;
        background: ${type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#3498db'};
        animation: fadeIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 5000);
}

/**
 * After a successful setup, call auth.login() to create the IPC session,
 * then store the session in localStorage for all renderer pages.
 */
async function performAutoLogin(email, password, source) {
    console.log('[SETUP] performAutoLogin called with email:', email);
    try {
        const loginResult = await window.api.auth.login({ email, password });
        console.log('[SETUP] auth.login result:', JSON.stringify(loginResult));
        if (loginResult?.success && loginResult.user) {
            const sessionData = {
                userId: Number(loginResult.user.userId || 0),
                name: String(loginResult.user.name || ''),
                email: String(loginResult.user.email || email || '').trim().toLowerCase(),
                role: String(loginResult.user.role || 'staff').toLowerCase(),
                loggedAt: Date.now(),
                source: String(source || loginResult.user.source || 'local-cache')
            };
            // Must match _computeSessionHash in utils.js exactly
            const payload = [sessionData.userId, sessionData.role, sessionData.loggedAt].join('|');
            const key = 'gsl_session_integrity_2024';
            const combined = key + ':' + payload;
            let hash = 0;
            for (let i = 0; i < combined.length; i++) {
                const char = combined.charCodeAt(i);
                hash = (hash << 5) - hash + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            sessionData._h = hash.toString(36);
            localStorage.setItem('gsl_auth_session_v1', JSON.stringify(sessionData));
            console.log('[SETUP] Session stored in localStorage');
            return true;
        }
    } catch (err) {
        console.warn('[SETUP] Auto-login failed:', err.message);
    }
    return false;
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[SETUP] DOMContentLoaded fired');

    const stepModeSelect = document.getElementById('step-mode-select');
    const stepNewInstitution = document.getElementById('step-new-institution');
    const btnModeNew = document.getElementById('btn-mode-new');
    const btnModeLogin = document.getElementById('btn-mode-login');
    const btnBackFromNew = document.getElementById('btn-back-from-new');
    const formNew = document.getElementById('form-new-institution');
    const btnSubmitNew = document.getElementById('btn-submit-new');

    console.log('[SETUP] DOM elements:', {
        formNew: !!formNew,
        btnSubmitNew: !!btnSubmitNew
    });

    try {
        const status = await window.api.institution.getStatus();
        console.log('[SETUP] Institution status:', JSON.stringify(status));
        if (status?.success && status.setupCompleted) {
            console.log('[SETUP] Already configured — redirecting to index.html');
            window.location.href = 'index.html';
            return;
        }
    } catch (err) {
        console.warn('[SETUP] Failed to read institution status:', err);
    }

    function showStep(stepElement) {
        stepModeSelect.classList.add('hidden');
        stepNewInstitution.classList.add('hidden');
        stepElement.classList.remove('hidden');

        // Trigger entrance animation
        stepElement.classList.remove('animate-step');
        void stepElement.offsetWidth; // force reflow
        stepElement.classList.add('animate-step');

        const firstInput = stepElement.querySelector('input');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    }

    function showFieldError(errorElementId, message) {
        console.log('[SETUP] showFieldError:', errorElementId, message);
        const errorElement = document.getElementById(errorElementId);
        if (!errorElement) {
            console.warn('[SETUP] Error element not found:', errorElementId);
            return;
        }

        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }

    function clearFieldErrors(formElement) {
        formElement.querySelectorAll('[id$="-error"]').forEach((element) => {
            element.textContent = '';
            element.classList.add('hidden');
        });
    }

    function isValidMassarCode(code) {
        return /^[A-Za-z]\d{4,8}$/.test(
            String(code || '')
                .trim()
                .toUpperCase()
        );
    }

    function getNormalizedMassarCode(inputId) {
        const input = document.getElementById(inputId);
        const normalized = String(input?.value || '')
            .trim()
            .toUpperCase();
        if (input) {
            input.value = normalized;
        }
        return normalized;
    }

    btnModeNew.addEventListener('click', () => showStep(stepNewInstitution));
    btnModeLogin.addEventListener('click', () => { window.location.href = 'login.html'; });
    btnBackFromNew.addEventListener('click', () => showStep(stepModeSelect));

    // ── New Institution Form ──
    formNew.addEventListener('submit', async (event) => {
        event.preventDefault();
        console.log('[SETUP] New institution form submitted');
        clearFieldErrors(formNew);

        const massarCode = getNormalizedMassarCode('new-massar-code');
        const institutionName = document.getElementById('new-institution-name').value.trim();
        const adminName = document.getElementById('new-admin-name').value.trim();
        const adminEmail = (document.getElementById('new-admin-email')?.value || '').trim().toLowerCase();
        const adminPassword = document.getElementById('new-admin-password').value;
        const adminConfirm = document.getElementById('new-admin-confirm').value;

        let hasError = false;

        if (!isValidMassarCode(massarCode)) {
            showFieldError('new-massar-error', 'رمز ماسار غير صالح - يجب أن يبدأ بحرف متبوعاً بـ 4-8 أرقام');
            hasError = true;
        }
        if (!adminName) {
            showFieldError('new-admin-name-error', 'اسم المدير مطلوب');
            hasError = true;
        }
        if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
            showFieldError('new-email-error', 'البريد الإلكتروني غير صالح');
            hasError = true;
        }
        if (!adminPassword || adminPassword.length < 6) {
            showFieldError('new-password-error', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
            hasError = true;
        }
        if (adminPassword !== adminConfirm) {
            showFieldError('new-confirm-error', 'كلمتا المرور غير متطابقتين');
            hasError = true;
        }

        if (hasError) {
            console.log('[SETUP] New institution validation failed');
            return;
        }

        const originalHtml = btnSubmitNew.innerHTML;
        btnSubmitNew.disabled = true;
        btnSubmitNew.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الإعداد...';

        try {
            console.log('[SETUP] Calling setupNewInstitution...');
            const result = await window.api.institution.setupNew({
                massarCode,
                institutionName,
                adminName,
                adminEmail,
                adminPassword
            });
            console.log('[SETUP] setupNewInstitution result:', JSON.stringify(result));

            if (result?.success) {
                showSetupToast(result.message || 'تم إعداد المؤسسة بنجاح', 'success');

                // Auto-login as admin
                let loggedIn = false;
                if (result.loginPayload?.email || result.autoLoginEmail) {
                    btnSubmitNew.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري تسجيل الدخول...';
                    loggedIn = await performAutoLogin(
                        result.loginPayload?.email || result.autoLoginEmail,
                        result.loginPayload?.password || adminPassword,
                        result.loginPayload?.source
                    );
                }

                setTimeout(() => {
                    window.location.href = loggedIn
                        ? 'index.html'
                        : `login.html?email=${encodeURIComponent(result.loginPayload?.email || result.autoLoginEmail || adminEmail)}`;
                }, 800);
            } else {
                showSetupToast(result?.error || 'حدث خطأ أثناء الإعداد', 'error');
            }
        } catch (err) {
            console.error('[SETUP] setupNewInstitution error:', err);
            showSetupToast('حدث خطأ غير متوقع: ' + err.message, 'error');
        } finally {
            btnSubmitNew.disabled = false;
            btnSubmitNew.innerHTML = originalHtml;
        }
    });

    console.log('[SETUP] All event listeners registered');
});

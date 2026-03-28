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
async function performAutoLogin(email, password) {
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
                source: 'sqlite'
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
    const stepLinkExisting = document.getElementById('step-link-existing');
    const btnModeNew = document.getElementById('btn-mode-new');
    const btnModeLink = document.getElementById('btn-mode-link');
    const btnBackFromNew = document.getElementById('btn-back-from-new');
    const btnBackFromLink = document.getElementById('btn-back-from-link');
    const formNew = document.getElementById('form-new-institution');
    const formLink = document.getElementById('form-link-existing');
    const btnSubmitNew = document.getElementById('btn-submit-new');
    const btnSubmitLink = document.getElementById('btn-submit-link');
    const linkProgress = document.getElementById('link-progress');
    const linkProgressText = document.getElementById('link-progress-text');
    const otpDigits = Array.from(document.querySelectorAll('.otp-digit'));

    console.log('[SETUP] DOM elements:', {
        formLink: !!formLink,
        btnSubmitLink: !!btnSubmitLink,
        linkProgress: !!linkProgress,
        otpDigitsCount: otpDigits.length
    });

    try {
        const status = await window.api.setup.getInstitutionStatus();
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
        stepLinkExisting.classList.add('hidden');
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
        return /^\d{3,8}[A-Za-z]{1,2}$/.test(
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

    function getOtpValue() {
        return otpDigits.map((digit) => digit.value).join('');
    }

    btnModeNew.addEventListener('click', () => showStep(stepNewInstitution));
    btnModeLink.addEventListener('click', () => showStep(stepLinkExisting));
    btnBackFromNew.addEventListener('click', () => showStep(stepModeSelect));
    btnBackFromLink.addEventListener('click', () => showStep(stepModeSelect));

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
            showFieldError('new-massar-error', 'رمز GRESA غير صالح - يجب أن يتكون من أرقام متبوعة بحرف أو حرفين (مثال: 14007Z)');
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
            const result = await window.api.setup.setupNewInstitution({
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
                if (result.autoLoginEmail) {
                    btnSubmitNew.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري تسجيل الدخول...';
                    await performAutoLogin(result.autoLoginEmail, adminPassword);
                }

                setTimeout(() => {
                    window.location.href = 'index.html';
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

    // ── OTP Digit Inputs ──
    otpDigits.forEach((input, index) => {
        input.addEventListener('input', (event) => {
            const value = event.target.value.replace(/[^0-9]/g, '');
            event.target.value = value;

            if (value && index < otpDigits.length - 1) {
                otpDigits[index + 1].focus();
            }
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Backspace' && !event.target.value && index > 0) {
                otpDigits[index - 1].focus();
            }
        });

        input.addEventListener('paste', (event) => {
            event.preventDefault();

            const pasted = (event.clipboardData.getData('text') || '')
                .replace(/[^0-9]/g, '')
                .slice(0, otpDigits.length);
            for (let i = 0; i < otpDigits.length; i += 1) {
                otpDigits[i].value = pasted[i] || '';
            }

            otpDigits[Math.min(pasted.length, otpDigits.length - 1)].focus();
        });
    });

    // ── Link to Existing Institution Form ──
    formLink.addEventListener('submit', async (event) => {
        event.preventDefault();
        console.log('[SETUP] ========== LINK FORM SUBMITTED ==========');
        clearFieldErrors(formLink);

        const massarCode = getNormalizedMassarCode('link-massar-code');
        const otp = getOtpValue();

        // Link account fields
        const roleSelect = document.getElementById('link-user-role');
        const rawRole = roleSelect ? roleSelect.value : 'staff-nazir';
        const userRole = rawRole.startsWith('staff') ? 'staff' : 'viewer';
        const userName = (document.getElementById('link-user-name')?.value || '').trim();
        const userEmail = (document.getElementById('link-user-email')?.value || '').trim().toLowerCase();
        const userPassword = document.getElementById('link-user-password')?.value || '';
        const userConfirm = document.getElementById('link-user-confirm')?.value || '';
        const primaryIp = (document.getElementById('link-primary-ip')?.value || '').trim() || undefined;

        console.log('[SETUP] Link form data:', {
            massarCode, otp, rawRole, userRole, userName, userEmail,
            passwordLen: userPassword.length, confirmLen: userConfirm.length,
            primaryIp
        });

        let hasError = false;
        if (!isValidMassarCode(massarCode)) {
            showFieldError('link-massar-error', 'رمز GRESA غير صالح - يجب أن يتكون من أرقام متبوعة بحرف أو حرفين (مثال: 14007Z)');
            hasError = true;
        }
        if (!userName || userName.length < 2) {
            showFieldError('link-name-error', 'الاسم مطلوب (حرفان على الأقل)');
            hasError = true;
        }
        if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
            showFieldError('link-email-error', 'البريد الإلكتروني غير صالح');
            hasError = true;
        }
        if (!userPassword || userPassword.length < 6) {
            showFieldError('link-password-error', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
            hasError = true;
        }
        if (userPassword !== userConfirm) {
            showFieldError('link-confirm-error', 'كلمتا المرور غير متطابقتين');
            hasError = true;
        }
        if (otp.length !== 6) {
            showFieldError('otp-error', 'أدخل رمز الربط المكون من 6 أرقام');
            hasError = true;
        }

        if (hasError) {
            console.log('[SETUP] Link form validation FAILED');
            return;
        }

        console.log('[SETUP] Link form validation PASSED — calling verifyAndLink...');

        const originalHtml = btnSubmitLink.innerHTML;
        btnSubmitLink.disabled = true;
        btnSubmitLink.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>جاري الربط...';
        linkProgress.classList.remove('hidden');
        linkProgressText.textContent = 'جاري البحث في الشبكة المحلية...';

        try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            linkProgressText.textContent = 'جاري التحقق من رمز الربط...';

            console.log('[SETUP] Invoking window.api.setup.verifyAndLink...');
            const result = await window.api.setup.verifyAndLink({
                massarCode,
                otp,
                userName,
                userEmail,
                userPassword,
                userRole,
                primaryIp
            });

            console.log('[SETUP] verifyAndLink result:', JSON.stringify(result));

            if (result?.success) {
                const viaText = result.verifiedVia === 'lan' ? 'عبر الشبكة المحلية' : 'عبر السيرفر';
                showSetupToast(`${result.message || 'تم ربط الجهاز بنجاح'} (${viaText})`, 'success');

                // Auto-login with the newly created account
                if (result.autoLoginEmail) {
                    linkProgressText.textContent = 'جاري تسجيل الدخول...';
                    await performAutoLogin(result.autoLoginEmail, userPassword);
                }

                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1000);
            } else {
                console.log('[SETUP] verifyAndLink FAILED:', result?.code, result?.error);
                showSetupToast(result?.error || 'فشل الربط - تأكد من صحة البيانات', 'error');
            }
        } catch (err) {
            console.error('[SETUP] verifyAndLink EXCEPTION:', err);
            showSetupToast('حدث خطأ غير متوقع: ' + err.message, 'error');
        } finally {
            btnSubmitLink.disabled = false;
            btnSubmitLink.innerHTML = originalHtml;
            linkProgress.classList.add('hidden');
        }
    });

    console.log('[SETUP] All event listeners registered');
});

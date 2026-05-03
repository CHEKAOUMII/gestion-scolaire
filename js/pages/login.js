const REMEMBER_KEY = 'gsl_remember_email';
const FORCE_PASSWORD_CHANGE_KEY = 'gsl_force_pw_change';
const SIGNUP_CONTEXTS = new Set(['setup', 'invite', 'otp', 'linked-device']);
const AUTH_DEBUG =
    /[?&]debugAuth=1(?:&|$)/.test(window.location.search) ||
    localStorage.getItem('debugAuth') === '1';
const PASSWORD_STRENGTH_LEVELS = [
    { width: '0%', tone: 'empty', label: '' },
    { width: '20%', tone: 'weak', label: 'ضعيفة' },
    { width: '40%', tone: 'fair', label: 'مقبولة' },
    { width: '60%', tone: 'medium', label: 'متوسطة' },
    { width: '80%', tone: 'good', label: 'جيدة' },
    { width: '100%', tone: 'strong', label: 'قوية' }
];

function maskEmail(email) {
    const value = String(email || '').trim().toLowerCase();
    if (!value || !value.includes('@')) return value || null;
    const [local, domain] = value.split('@');
    return `${local.slice(0, 2)}${local.length > 2 ? '***' : '*'}@${domain}`;
}

function debugAuth(event, meta = {}) {
    if (!AUTH_DEBUG) return;
    const safe = {};
    Object.entries(meta || {}).forEach(([key, value]) => {
        if (/password|token|secret|key/i.test(key)) return;
        safe[key] = key === 'email' ? maskEmail(value) : value;
    });
    console.log('[auth:ui]', event, safe);
}

function getAuthMode(sessionUser, response) {
    const mode = String(
        response?.authMode ||
            response?.mode ||
            sessionUser?.lastAuthMode ||
            sessionUser?.last_auth_mode ||
            sessionUser?.authMode ||
            sessionUser?.source ||
            'firebase'
    ).toLowerCase();
    return mode === 'offline' ? 'offline' : 'firebase';
}

function saveLocalSession(sessionUser, fallbackEmail, fallbackName, response) {
    const sessionData = {
        userId: Number(sessionUser.userId || 0),
        name: String(sessionUser.name || fallbackName || ''),
        email: String(sessionUser.email || fallbackEmail || '')
            .trim()
            .toLowerCase(),
        role: String(sessionUser.role || 'staff'),
        loggedAt: Date.now(),
        source: getAuthMode(sessionUser, response)
    };
    localStorage.setItem('gsl_auth_session_v1', JSON.stringify(sessionData));
}

function syncPasswordToggleState(button, input) {
    if (!button || !input) return;
    const isVisible = input.type === 'text';
    const label = isVisible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور';
    const icon = button.querySelector('i');
    if (icon) {
        icon.className = isVisible ? 'fas fa-eye-slash' : 'fas fa-eye';
        icon.setAttribute('aria-hidden', 'true');
    }
    button.setAttribute('aria-pressed', String(isVisible));
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
}

function updatePasswordStrength(password, strengthBar, strengthLabel) {
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    const level = PASSWORD_STRENGTH_LEVELS[Math.min(score, PASSWORD_STRENGTH_LEVELS.length - 1)];
    strengthBar.style.width = level.width;
    strengthBar.dataset.strength = level.tone;
    strengthLabel.textContent = password.length > 0 ? level.label : '';
    strengthLabel.dataset.strength = password.length > 0 ? level.tone : 'empty';
}

function getSafeNextPage() {
    const params = new URLSearchParams(window.location.search);
    const next = String(params.get('next') || '').trim();
    if (/^[a-zA-Z0-9._-]+\.html$/.test(next)) return next;
    return 'index.html';
}

function clearLocalSession() {
    try {
        localStorage.removeItem('gsl_auth_session_v1');
    } catch (err) {
        console.warn('[auth:ui] clearLocalSession failed:', err);
    }
}

function saveRememberMe(email, rememberMe) {
    try {
        if (rememberMe?.checked) {
            localStorage.setItem(REMEMBER_KEY, email);
        } else {
            localStorage.removeItem(REMEMBER_KEY);
        }
    } catch (err) {
        console.warn('[auth:ui] saveRememberMe failed:', err);
    }
}

function getAuthContext() {
    const params = new URLSearchParams(window.location.search);
    const rawContext = String(params.get('context') || params.get('signup') || params.get('mode') || '')
        .trim()
        .toLowerCase();
    const hasInvite = Boolean(String(params.get('invite') || params.get('otp') || '').trim());
    return {
        allowSignup: SIGNUP_CONTEXTS.has(rawContext) || hasInvite,
        forceChangePassword: window.location.hash === '#change-password' || sessionStorage.getItem(FORCE_PASSWORD_CHANGE_KEY) === '1'
    };
}

function setAuthForm(activeFormId) {
    document.querySelectorAll('.auth-form').forEach((form) => {
        form.classList.toggle('active', form.id === activeFormId);
    });
}

function setActiveTab(activeTabId) {
    document.querySelectorAll('.auth-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.id === activeTabId);
    });
}

function showLoginMessage(element, textElement, message) {
    if (!element || !textElement) return;
    textElement.textContent = message || '';
    element.classList.toggle('show', Boolean(message));
}

function getLoginErrorMessage(error) {
    const rawCode = String(error?.code || error?.errorCode || '').toUpperCase().replace(/^AUTH[/:_-]/, '');
    switch (rawCode) {
        case 'USER_NOT_FOUND':
        case 'EMAIL_NOT_FOUND':
        case 'USER-NOT-FOUND':
            return 'البريد الإلكتروني غير مسجل';
        case 'INVALID_CREDENTIALS':
        case 'INVALID_LOGIN_CREDENTIALS':
        case 'WRONG_PASSWORD':
        case 'INVALID-CREDENTIAL':
            return 'كلمة المرور غير صحيحة';
        case 'INVALID_EMAIL':
        case 'INVALID-EMAIL':
            return 'البريد الإلكتروني غير صالح';
        case 'INVALID_PASSWORD':
            return 'كلمة المرور مطلوبة';
        case 'PASSWORD_NOT_SET':
            return 'لم يتم إعداد كلمة مرور لهذا المستخدم';
        case 'USER_DISABLED':
        case 'USER-DISABLED':
            return 'هذا المستخدم معطّل من طرف الإدارة';
        case 'WEAK_PASSWORD':
        case 'WEAK-PASSWORD':
            return 'كلمة المرور ضعيفة. استعمل 6 أحرف على الأقل مع أرقام أو رموز';
        case 'NETWORK_REQUEST_FAILED':
        case 'NETWORK_ERROR':
        case 'UNAVAILABLE':
            return 'تعذر الاتصال بخدمة المصادقة. إذا سبق لك الدخول على هذا الجهاز فسيتم استعمال الدخول المحلي عند توفره';
        case 'OFFLINE_FALLBACK_UNAVAILABLE':
        case 'OFFLINE_LOGIN_UNAVAILABLE':
            return 'لا يمكن الدخول بدون اتصال إلا لحساب سبق له تسجيل الدخول على هذا الجهاز';
        case 'LOCAL_SCHOOL_ID_MISSING':
            return 'تعذر تحديد رمز المؤسسة من الحساب السحابي. اطلب من المدير إعادة ربط الحساب بالمؤسسة';
        case 'FIREBASE_PROFILE_REQUIRED':
        case 'FIREBASE_SCHOOL_MISMATCH':
            return 'هذا الحساب غير مرتبط بهذه المؤسسة';
        case 'TOO_MANY_REQUESTS':
        case 'TOO-MANY-REQUESTS':
        case 'LOCKED':
            return 'تم إيقاف المحاولة مؤقتاً بسبب تكرار محاولات الدخول. حاول لاحقاً';
        case 'ALREADY_CONFIGURED':
        case 'SIGNUP_DISABLED':
            return 'إنشاء الحسابات متاح فقط من الإعداد الأولي أو بدعوة من الإدارة';
        default:
            return error?.message || error?.error || 'حدث خطأ أثناء تسجيل الدخول';
    }
}

function getChangePasswordErrorMessage(responseOrError) {
    const code = String(responseOrError?.code || '').toUpperCase();
    switch (code) {
        case 'MISSING_CURRENT':
            return 'كلمة المرور الحالية مطلوبة';
        case 'INVALID_CURRENT':
            return 'كلمة المرور الحالية غير صحيحة';
        case 'WEAK_PASSWORD':
            return 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل';
        case 'USER_NOT_FOUND':
            return 'تعذر العثور على المستخدم الحالي';
        default:
            return responseOrError?.error || responseOrError?.message || 'تعذر تغيير كلمة المرور';
    }
}

function setMessageState(element, message) {
    element.textContent = message || '';
    element.classList.toggle('show', Boolean(message));
}

async function checkExistingAdminSession() {
    if (!window.api?.auth?.getSession) return;
    if (getAuthContext().forceChangePassword) return;
    try {
        const response = await window.api.auth.getSession();
        if (response?.success && response?.authenticated && response.user?.role) {
            saveLocalSession(response.user, response.user.email, response.user.name, response);
            if (response.user.mustChangePassword) {
                sessionStorage.setItem(FORCE_PASSWORD_CHANGE_KEY, '1');
                window.location.hash = 'change-password';
                showChangePasswordView();
                return;
            }
            const nextPage = getSafeNextPage();
            window.location.replace(`${nextPage}?loggedin=1`);
        }
    } catch (err) {
        console.warn('[auth:ui] session check failed:', err);
    }
}

async function enforceSetupContext(loginError, loginErrorText) {
    if (!window.api?.linking?.getInstitutionStatus) return true;
    try {
        const response = await window.api.linking.getInstitutionStatus();
        if (response?.success && !response.setupCompleted) {
            window.location.replace('setup.html');
            return false;
        }
    } catch (error) {
        showLoginMessage(
            loginError,
            loginErrorText,
            'تعذر قراءة إعداد المؤسسة. يمكنك محاولة تسجيل الدخول، وسيتم استعمال الدخول المحلي فقط إذا كان متاحاً.'
        );
    }
    return true;
}

function showChangePasswordView() {
    setAuthForm('form-change-password');
    setActiveTab('');
    const tabs = document.querySelector('.auth-tabs');
    if (tabs) tabs.style.display = 'none';
    setTimeout(() => document.getElementById('current-password')?.focus(), 100);
}

function showLoginView() {
    const tabs = document.querySelector('.auth-tabs');
    if (tabs) tabs.style.display = '';
    setAuthForm('form-login');
    setActiveTab('tab-login');
}

function initLoginPage() {
    const authContext = getAuthContext();
    const loginForm = document.getElementById('login-form');
    const changePasswordForm = document.getElementById('change-password-form');
    const btnLogin = document.getElementById('btn-login');
    const btnChangePassword = document.getElementById('btn-change-password');
    const loginError = document.getElementById('login-error');
    const loginErrorText = document.getElementById('login-error-text');
    const loginSuccess = document.getElementById('login-success');
    const loginSuccessText = document.getElementById('login-success-text');
    const changePasswordError = document.getElementById('change-password-error');
    const changePasswordErrorText = document.getElementById('change-password-error-text');
    const changePasswordSuccess = document.getElementById('change-password-success');
    const changePasswordSuccessText = document.getElementById('change-password-success-text');
    const newPassword = document.getElementById('new-password');
    const newStrengthBar = document.getElementById('new-pw-strength-bar');
    const newStrengthLabel = document.getElementById('new-pw-strength-label');
    const loginEmail = document.getElementById('login-email');
    const rememberMe = document.getElementById('remember-me');

    if (!loginForm || !changePasswordForm || !btnLogin || !btnChangePassword) return;

    if (authContext.forceChangePassword) {
        showChangePasswordView();
    } else {
        showLoginView();
    }

    window.addEventListener('hashchange', () => {
        if (getAuthContext().forceChangePassword) {
            showChangePasswordView();
        }
    });

    document.querySelectorAll('.auth-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            if (tab.disabled) return;
            const target = tab.dataset.tab;
            setActiveTab(tab.id);
            setAuthForm(`form-${target}`);
            showLoginMessage(loginError, loginErrorText, '');
            showLoginMessage(loginSuccess, loginSuccessText, '');
        });
    });

    document.querySelectorAll('.password-toggle').forEach((button) => {
        const targetId = button.dataset.target;
        const input = document.getElementById(targetId);
        syncPasswordToggleState(button, input);
        button.addEventListener('click', () => {
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
            syncPasswordToggleState(button, input);
        });
    });

    newPassword?.addEventListener('input', () => {
        updatePasswordStrength(newPassword.value, newStrengthBar, newStrengthLabel);
    });

    try {
        const savedEmail = localStorage.getItem(REMEMBER_KEY);
        if (savedEmail && loginEmail && rememberMe) {
            loginEmail.value = savedEmail;
            rememberMe.checked = true;
        }
    } catch (err) {
        console.warn('[auth:ui] restoring remembered email failed:', err);
    }

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = loginEmail.value.trim().toLowerCase();
        const password = document.getElementById('login-password').value;

        btnLogin.classList.add('loading');
        btnLogin.disabled = true;
        showLoginMessage(loginError, loginErrorText, '');
        showLoginMessage(loginSuccess, loginSuccessText, '');

        try {
            if (!window.api?.auth?.login) {
                throw new Error('تعذر تهيئة جلسة التطبيق');
            }

            debugAuth('login.submit', { email });
            const response = await window.api.auth.login({ email, password });
            debugAuth('login.response', {
                email,
                success: !!response?.success,
                authenticated: !!response?.authenticated,
                code: response?.code || null,
                authMode: response?.authMode || response?.user?.authMode || null,
                role: response?.user?.role || null,
                error: response?.error || null
            });
            if (!response?.success || !response?.authenticated) {
                clearLocalSession();
                if (response?.code === 'LINK_REQUEST_SUBMITTED') {
                    showLoginMessage(loginError, loginErrorText, '');
                    showLoginMessage(loginSuccess, loginSuccessText, response.error || 'تم إرسال طلب ربط حسابك بالمؤسسة. انتظر موافقة المدير ثم أعد تسجيل الدخول');
                } else {
                    let diagSuffix = '';
                    if (response?._diag) {
                        const d = response._diag;
                        diagSuffix = `\n[DIAG] code=${d.firebaseCode || '?'} | msg=${d.message || '?'}`;
                    }
                    showLoginMessage(loginError, loginErrorText, getLoginErrorMessage(response) + diagSuffix);
                }
                btnLogin.classList.remove('loading');
                btnLogin.disabled = false;
                return;
            }

            saveRememberMe(email, rememberMe);
            saveLocalSession(response.user || {}, email, '', response);
            if (response.user?.mustChangePassword) {
                sessionStorage.setItem(FORCE_PASSWORD_CHANGE_KEY, '1');
                window.location.hash = 'change-password';
                btnLogin.classList.remove('loading');
                btnLogin.disabled = false;
                showChangePasswordView();
                return;
            }

            if (getAuthMode(response.user || {}, response) === 'offline') {
                showLoginMessage(
                    loginSuccess,
                    loginSuccessText,
                    'تم تسجيل الدخول محلياً بسبب تعذر الاتصال. ستتم مزامنة الجلسة عند عودة الشبكة.'
                );
                setTimeout(() => {
                    window.location.replace(`${getSafeNextPage()}?loggedin=1`);
                }, 900);
                return;
            }

            window.location.replace(`${getSafeNextPage()}?loggedin=1`);
        } catch (error) {
            debugAuth('login.exception', {
                email,
                code: error?.code || null,
                message: error?.message || String(error)
            });
            showLoginMessage(loginError, loginErrorText, getLoginErrorMessage(error));
            btnLogin.classList.remove('loading');
            btnLogin.disabled = false;
        }
    });

    changePasswordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const currentPassword = document.getElementById('current-password').value;
        const newPasswordValue = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('new-password-confirm').value;

        showLoginMessage(changePasswordError, changePasswordErrorText, '');
        showLoginMessage(changePasswordSuccess, changePasswordSuccessText, '');

        if (newPasswordValue !== confirmPassword) {
            showLoginMessage(changePasswordError, changePasswordErrorText, 'كلمتا المرور الجديدتان غير متطابقتين');
            return;
        }
        if (newPasswordValue.length < 6) {
            showLoginMessage(changePasswordError, changePasswordErrorText, getChangePasswordErrorMessage({ code: 'WEAK_PASSWORD' }));
            return;
        }
        if (currentPassword === newPasswordValue) {
            showLoginMessage(changePasswordError, changePasswordErrorText, 'استعمل كلمة مرور جديدة مختلفة عن الحالية');
            return;
        }

        btnChangePassword.classList.add('loading');
        btnChangePassword.disabled = true;

        try {
            if (!window.api?.auth?.changePassword) {
                throw new Error('تعذر تهيئة تغيير كلمة المرور');
            }

            const response = await window.api.auth.changePassword({
                currentPassword,
                newPassword: newPasswordValue
            });
            if (!response?.success) {
                showLoginMessage(changePasswordError, changePasswordErrorText, getChangePasswordErrorMessage(response));
                btnChangePassword.classList.remove('loading');
                btnChangePassword.disabled = false;
                return;
            }

            sessionStorage.removeItem(FORCE_PASSWORD_CHANGE_KEY);
            showLoginMessage(changePasswordSuccess, changePasswordSuccessText, 'تم تغيير كلمة المرور بنجاح. جاري فتح التطبيق...');
            setTimeout(() => {
                window.location.replace(`${getSafeNextPage()}?loggedin=1`);
            }, 900);
        } catch (error) {
            showLoginMessage(changePasswordError, changePasswordErrorText, getChangePasswordErrorMessage(error));
            btnChangePassword.classList.remove('loading');
            btnChangePassword.disabled = false;
        }
    });

    enforceSetupContext(loginError, loginErrorText).then((canContinue) => {
        if (canContinue) checkExistingAdminSession();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginPage);
} else {
    initLoginPage();
}

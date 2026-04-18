const REMEMBER_KEY = 'gsl_remember_email';
const PASSWORD_STRENGTH_LEVELS = [
    { width: '0%', tone: 'empty', label: '' },
    { width: '20%', tone: 'weak', label: 'ضعيفة' },
    { width: '40%', tone: 'fair', label: 'مقبولة' },
    { width: '60%', tone: 'medium', label: 'متوسطة' },
    { width: '80%', tone: 'good', label: 'جيدة' },
    { width: '100%', tone: 'strong', label: 'قوية' }
];

function computeSessionHash(data) {
    const payload = [data.userId, data.role, data.loggedAt].join('|');
    let hash = 0;
    const key = 'gsl_session_integrity_2024';
    const combined = `${key}:${payload}`;
    for (let index = 0; index < combined.length; index += 1) {
        const char = combined.charCodeAt(index);
        hash = (hash << 5) - hash + char;
        hash &= hash;
    }
    return hash.toString(36);
}

function saveLocalSession(sessionUser, fallbackEmail, fallbackName) {
    const sessionData = {
        userId: Number(sessionUser.userId || 0),
        name: String(sessionUser.name || fallbackName || ''),
        email: String(sessionUser.email || fallbackEmail || '')
            .trim()
            .toLowerCase(),
        role: String(sessionUser.role || 'staff'),
        loggedAt: Date.now(),
        source: 'sqlite'
    };
    sessionData._h = computeSessionHash(sessionData);
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
    } catch {}
}

function saveRememberMe(email, rememberMe) {
    try {
        if (rememberMe.checked) {
            localStorage.setItem(REMEMBER_KEY, email);
        } else {
            localStorage.removeItem(REMEMBER_KEY);
        }
    } catch {}
}

function getLoginErrorMessage(error) {
    switch (error.code) {
        case 'USER_NOT_FOUND':
            return 'البريد الإلكتروني غير مسجل';
        case 'INVALID_CREDENTIALS':
            return 'كلمة المرور غير صحيحة';
        case 'INVALID_EMAIL':
            return 'البريد الإلكتروني غير صالح';
        case 'INVALID_PASSWORD':
            return 'كلمة المرور مطلوبة';
        case 'PASSWORD_NOT_SET':
            return 'لم يتم إعداد كلمة مرور لهذا المستخدم';
        case 'USER_DISABLED':
            return 'هذا المستخدم معطّل من طرف الإدارة';
        default:
            return 'حدث خطأ أثناء تسجيل الدخول';
    }
}

function buildPinPromptMarkup() {
    return `
        <div class="pin-prompt-hero">
            <div class="pin-prompt-icon">
                <i class="fas fa-fingerprint"></i>
            </div>
            <h3 class="pin-prompt-title">إعداد رمز PIN</h3>
            <p class="pin-prompt-copy">رمز PIN يتيح لك قفل وفتح الجلسة بسرعة دون كلمة المرور.</p>
        </div>
        <div id="pin-prompt-error" class="error-message pin-prompt-message"></div>
        <div id="pin-prompt-success" class="success-message pin-prompt-message"></div>
        <form id="pin-prompt-form" class="pin-prompt-form">
            <div class="form-group pin-prompt-field">
                <label class="pin-prompt-label">رمز PIN (4-6 أرقام)</label>
                <input class="pin-prompt-input" type="password" id="pin-prompt-new" inputmode="numeric" pattern="[0-9]*" required minlength="4" maxlength="6">
            </div>
            <div class="form-group pin-prompt-field">
                <label class="pin-prompt-label">تأكيد رمز PIN</label>
                <input class="pin-prompt-input" type="password" id="pin-prompt-confirm" inputmode="numeric" pattern="[0-9]*" required minlength="4" maxlength="6">
            </div>
            <button type="submit" class="btn-login pin-prompt-submit">
                <span><i class="fas fa-lock"></i> حفظ رمز PIN</span>
            </button>
        </form>
        <button type="button" id="pin-prompt-skip" class="pin-prompt-skip">
            تخطي — يمكنك إعداده لاحقاً
        </button>`;
}

function setMessageState(element, message) {
    element.textContent = message || '';
    element.classList.toggle('show', Boolean(message));
}

function showPinSetupPrompt() {
    const card = document.querySelector('.login-card');
    if (!card) {
        window.location.replace('index.html');
        return;
    }

    document.querySelectorAll('.auth-form').forEach((form) => {
        form.style.display = 'none';
    });

    const authTabs = document.querySelector('.auth-tabs');
    if (authTabs) {
        authTabs.style.display = 'none';
    }

    const pinPrompt = document.createElement('div');
    pinPrompt.className = 'pin-prompt-shell';
    pinPrompt.innerHTML = buildPinPromptMarkup();
    card.appendChild(pinPrompt);

    pinPrompt.querySelector('#pin-prompt-skip')?.addEventListener('click', () => {
        window.location.replace('index.html');
    });

    pinPrompt.querySelector('#pin-prompt-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorElement = pinPrompt.querySelector('#pin-prompt-error');
        const successElement = pinPrompt.querySelector('#pin-prompt-success');
        setMessageState(errorElement, '');
        setMessageState(successElement, '');

        const pin = pinPrompt.querySelector('#pin-prompt-new')?.value || '';
        const confirmPin = pinPrompt.querySelector('#pin-prompt-confirm')?.value || '';

        if (!/^\d{4,6}$/.test(pin)) {
            setMessageState(errorElement, 'رمز PIN يجب أن يكون من 4 إلى 6 أرقام');
            return;
        }
        if (pin !== confirmPin) {
            setMessageState(errorElement, 'رمزا PIN غير متطابقين');
            return;
        }

        try {
            const response = await window.api.auth.setupPin({ pin });
            if (!response?.success) {
                setMessageState(errorElement, response?.error || 'فشل حفظ رمز PIN');
                return;
            }
            setMessageState(successElement, 'تم حفظ رمز PIN بنجاح! جاري التحويل...');
            setTimeout(() => {
                window.location.replace('index.html');
            }, 1200);
        } catch (error) {
            setMessageState(errorElement, error.message || 'حدث خطأ');
        }
    });

    setTimeout(() => {
        pinPrompt.querySelector('#pin-prompt-new')?.focus();
    }, 100);
}

async function checkExistingAdminSession() {
    if (!window.api?.auth?.getSession) return;
    try {
        const response = await window.api.auth.getSession();
        if (response?.success && response?.authenticated && response.user?.role) {
            saveLocalSession(response.user, response.user.email, response.user.name);
            const nextPage = getSafeNextPage();
            window.location.replace(`${nextPage}?loggedin=1`);
        }
    } catch {}
}

function initLoginPage() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const btnLogin = document.getElementById('btn-login');
    const btnRegister = document.getElementById('btn-register');
    const loginError = document.getElementById('login-error');
    const loginErrorText = document.getElementById('login-error-text');
    const registerError = document.getElementById('register-error');
    const registerErrorText = document.getElementById('register-error-text');
    const registerSuccess = document.getElementById('register-success');
    const registerSuccessText = document.getElementById('register-success-text');
    const regPassword = document.getElementById('reg-password');
    const strengthBar = document.getElementById('pw-strength-bar');
    const strengthLabel = document.getElementById('pw-strength-label');
    const loginEmail = document.getElementById('login-email');
    const rememberMe = document.getElementById('remember-me');

    if (!loginForm || !registerForm || !btnLogin || !btnRegister) return;

    document.querySelectorAll('.auth-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            document.querySelectorAll('.auth-tab').forEach((item) => item.classList.remove('active'));
            document.querySelectorAll('.auth-form').forEach((form) => form.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`form-${target}`)?.classList.add('active');
            loginError.classList.remove('show');
            registerError.classList.remove('show');
            registerSuccess.classList.remove('show');
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

    regPassword?.addEventListener('input', () => {
        updatePasswordStrength(regPassword.value, strengthBar, strengthLabel);
    });

    try {
        const savedEmail = localStorage.getItem(REMEMBER_KEY);
        if (savedEmail && loginEmail && rememberMe) {
            loginEmail.value = savedEmail;
            rememberMe.checked = true;
        }
    } catch {}

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = loginEmail.value;
        const password = document.getElementById('login-password').value;

        btnLogin.classList.add('loading');
        btnLogin.disabled = true;
        loginError.classList.remove('show');

        try {
            if (!window.api?.auth?.login) {
                throw new Error('تعذر تهيئة جلسة التطبيق');
            }

            const response = await window.api.auth.login({ email, password });
            if (!response?.success || !response?.authenticated) {
                clearLocalSession();
                loginErrorText.textContent = response?.error || 'فشل تسجيل الدخول';
                loginError.classList.add('show');
                btnLogin.classList.remove('loading');
                btnLogin.disabled = false;
                return;
            }

            saveRememberMe(email, rememberMe);
            saveLocalSession(response.user || {}, email, '');
            if (response.user?.mustChangePassword) {
                sessionStorage.setItem('gsl_force_pw_change', '1');
                window.location.replace('login.html#change-password');
                return;
            }
            window.location.replace(`${getSafeNextPage()}?loggedin=1`);
        } catch (error) {
            loginErrorText.textContent = getLoginErrorMessage(error);
            loginError.classList.add('show');
            btnLogin.classList.remove('loading');
            btnLogin.disabled = false;
        }
    });

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('reg-password-confirm').value;

        registerError.classList.remove('show');
        registerSuccess.classList.remove('show');

        if (password !== confirmPassword) {
            registerErrorText.textContent = 'كلمتا المرور غير متطابقتين';
            registerError.classList.add('show');
            return;
        }
        if (password.length < 6) {
            registerErrorText.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
            registerError.classList.add('show');
            return;
        }

        btnRegister.classList.add('loading');
        btnRegister.disabled = true;

        try {
            if (!window.api?.auth?.register) {
                throw new Error('تعذر تهيئة جلسة التطبيق');
            }

            const response = await window.api.auth.register({ name, email, password });
            if (!response?.success) {
                registerErrorText.textContent = response?.error || 'فشل إنشاء الحساب';
                registerError.classList.add('show');
                btnRegister.classList.remove('loading');
                btnRegister.disabled = false;
                return;
            }

            registerSuccessText.textContent = 'تم إنشاء حسابك بنجاح!';
            registerSuccess.classList.add('show');
            saveLocalSession(response.user || {}, email, name);
            showPinSetupPrompt();
        } catch (error) {
            registerErrorText.textContent = error.message || 'حدث خطأ أثناء إنشاء الحساب';
            registerError.classList.add('show');
            btnRegister.classList.remove('loading');
            btnRegister.disabled = false;
        }
    });

    checkExistingAdminSession();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginPage);
} else {
    initLoginPage();
}

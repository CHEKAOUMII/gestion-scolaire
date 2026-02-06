// Firebase Configuration - Shared across all pages
// ملف تهيئة Firebase الموحد

const firebaseConfig = {
    apiKey: "AIzaSyCdhGx_UNgo3Ynx2__7xYNHThN68U0Hnak",
    authDomain: "gestionscholaire.firebaseapp.com",
    projectId: "gestionscholaire",
    storageBucket: "gestionscholaire.firebasestorage.app",
    messagingSenderId: "971615999680",
    appId: "1:971615999680:web:46c0e1f2e10a3c8ecb7f25"
};

// Initialize Firebase (only once)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

// دالة التحقق من المصادقة الموحدة - مع منع حلقة التوجيه
function checkAuthentication(redirectToLogin = true) {
    return new Promise((resolve, reject) => {
        // Check if we just logged in
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('loggedin') === '1') {
            window.history.replaceState({}, '', window.location.pathname);
            resolve(null); // Assume logged in
            return;
        }

        let authCheckDone = false;

        setTimeout(() => {
            auth.onAuthStateChanged(user => {
                if (authCheckDone) return;
                authCheckDone = true;

                if (!user && redirectToLogin) {
                    window.location.replace('login.html');
                    reject('Not authenticated');
                } else {
                    resolve(user);
                }
            });
        }, 100);
    });
}

// دالة الحماية من XSS
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// دالة تسجيل الخروج
async function logout() {
    if (confirm('هل تريد تسجيل الخروج؟')) {
        await auth.signOut();
        window.location.href = 'login.html';
    }
}

// دالة عرض رسائل Toast آمنة
function showToast(message, type = 'success') {
    // إزالة أي toast موجود
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    // إنشاء toast جديد مع حماية XSS
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // استخدام textContent بدلاً من innerHTML للأمان
    const icon = document.createElement('i');
    icon.className = `fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}`;

    const span = document.createElement('span');
    span.textContent = message; // آمن من XSS

    toast.appendChild(icon);
    toast.appendChild(span);
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

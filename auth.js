// auth.js - Client-side Authentication Handler (VERSI FINAL & ANTI KEDIP-KEDIP)
document.addEventListener('DOMContentLoaded', () => {
    const authMode = getAuthMode(); // 'signin', 'signup', 'forgot', 'reset', 'none'

    // Skip jika bukan halaman auth
    if (authMode === 'none') return;

    // JANGAN PERNAH redirect otomatis dari halaman login/signup/forgot
    // Biarkan server.js yang mengatur semua alur
    checkTokenValidityOnly(); // Hanya cek token, jangan redirect

    // Inisialisasi form sesuai halaman
    if (authMode === 'signup') {
        initSignupForm();
    } else if (authMode === 'forgot') {
        initForgotPasswordForm();
    } else if (authMode === 'reset') {
        initResetPasswordForm();
    } else if (authMode === 'signin') {
        initSigninForm();
    }

    // Google OAuth handler
    initGoogleOAuth();

    // Jika ada parameter sukses dari Google OAuth, langsung ke lobby
    if (window.location.search.includes('google=success')) {
        window.location.href = '/';
    }
});

function getAuthMode() {
    const path = window.location.pathname;
    if (path.includes('signup')) return 'signup';
    if (path.includes('forgot')) return 'forgot';
    if (path.includes('reset')) return 'reset';
    if (path.includes('signin')) return 'signin';
    return 'none'; // Bukan halaman auth
}

// Hanya validasi token (tidak redirect!)
async function checkTokenValidityOnly() {
    const token = localStorage.getItem('auction_token');

    if (!token) return;

    try {
        const response = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            // Token invalid → bersihkan
            localStorage.removeItem('auction_token');
            localStorage.removeItem('auction_user');
        }
    } catch (err) {
        // Silent fail (jaringan mati dll)
        console.warn('Token verification failed:', err);
    }
}

// ==================== SIGN IN ====================
function initSigninForm() {
    const form = document.getElementById('signinForm');
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    const submitBtn = document.getElementById('submitBtn');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (!email || !password) {
            showError(errorMsg, 'Please fill in all fields');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
            const res = await fetch('/api/auth/signin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();

            if (data.ok) {
                localStorage.setItem('auction_token', data.token);
                localStorage.setItem('auction_user', JSON.stringify(data.user));
                showSuccess(successMsg, 'Login successful! Redirecting...');

                // Jika perlu reset password (menggunakan temporary password), redirect ke reset.html
                setTimeout(() => {
                    if (data.requires_password_reset) {
                        window.location.href = '/reset.html';
                    } else {
                        window.location.href = '/';
                    }
                }, 800);
            } else {
                showError(errorMsg, data.error || 'Login failed');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign In';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
        }
    });
}

// ==================== SIGN UP ====================
function initSignupForm() {
    const form = document.getElementById('signupForm');
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    const submitBtn = document.getElementById('submitBtn');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        // Validasi frontend
        if (!name || name.length < 2) {
            showError(errorMsg, 'Name must be at least 2 characters');
            return;
        }
        if (!email || !password || !confirmPassword) {
            showError(errorMsg, 'All fields are required');
            return;
        }
        if (password.length < 8) {
            showError(errorMsg, 'Password must be at least 8 characters');
            return;
        }
        if (password !== confirmPassword) {
            showError(errorMsg, 'Passwords do not match');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account...';

        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })  // Kirim name!
            });

            const data = await res.json();

            if (data.ok) {
                showSuccess(successMsg, 'Account created! Please check your email to verify.');
                setTimeout(() => {
                    window.location.href = '/signin.html';
                }, 3000);
            } else {
                showError(errorMsg, data.error || 'Signup failed');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign Up';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign Up';
        }
    });
}
// ==================== FORGOT PASSWORD ====================
function initForgotPasswordForm() {
    const form = document.getElementById('forgotForm');
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    const submitBtn = document.getElementById('submitBtn');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const email = document.getElementById('email').value.trim();
        if (!email) {
            showError(errorMsg, 'Please enter your email');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await res.json();

            if (data.ok) {
                showSuccess(successMsg, 'Temporary password sent to your email!');
                submitBtn.textContent = 'Sent!';
            } else {
                showError(errorMsg, data.error || 'Failed to send email');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Temporary Password';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Temporary Password';
        }
    });
}

// ==================== RESET PASSWORD ====================
function initResetPasswordForm() {
    const form = document.getElementById('resetForm');
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');
    const submitBtn = document.getElementById('submitBtn');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideMessage(errorMsg);
        hideMessage(successMsg);

        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (newPassword !== confirmPassword) {
            showError(errorMsg, 'Passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            showError(errorMsg, 'Password must be at least 8 characters');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating...';

        const token = localStorage.getItem('auction_token');

        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ newPassword })
            });

            const data = await res.json();

            if (data.ok) {
                showSuccess(successMsg, 'Password updated! Redirecting...');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
            } else {
                showError(errorMsg, data.error || 'Failed to update password');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Update Password';
            }
        } catch (err) {
            showError(errorMsg, 'Connection error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Update Password';
        }
    });
}

// ==================== GOOGLE OAUTH ====================
function initGoogleOAuth() {
    const googleBtn = document.getElementById('googleSignin');
    if (!googleBtn) return;

    googleBtn.addEventListener('click', () => {
        window.location.href = '/api/auth/google';
    });
}

// ==================== UTILITY FUNCTIONS ====================
function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.style.display = 'block';
}

function showSuccess(element, message) {
    if (!element) return;
    element.textContent = message;
    element.style.display = 'block';
    element.style.color = '#10b981';
}

function hideMessage(element) {
    if (element) element.style.display = 'none';
}

// Logout function (bisa dipanggil dari mana saja)
window.logout = function () {
    localStorage.removeItem('auction_token');
    localStorage.removeItem('auction_user');
    window.location.href = '/signin.html';
};

// Export untuk script lain
window.getAuthToken = () => localStorage.getItem('auction_token');
window.getAuthUser = () => JSON.parse(localStorage.getItem('auction_user') || 'null');
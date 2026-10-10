/* ==========================================================================
   LOGIN / REGISTER PAGE LOGIC
   Talks to: POST /api/login, POST /api/register
   ========================================================================== */

let isLogin = true;

// Already signed in? Skip straight to the dashboard.
if (localStorage.getItem('ev_user')) {
    window.location.replace('dashboard.html');
}

const $ = (id) => document.getElementById(id);

/* ---------- Toasts ---------- */
const TOAST_ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
};
function showToast(message, type = 'info', ms = 3800) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<svg class="t-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[type] || TOAST_ICONS.info}</svg><div></div>`;
    el.lastElementChild.textContent = message;
    $('toast-root').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

/* ---------- Inline form error ---------- */
function showError(msg) {
    $('form-error-text').textContent = msg;
    $('form-error').classList.add('show');
}
function clearError() { $('form-error').classList.remove('show'); }

/* ---------- Login <-> Register switching ---------- */
function setMode(loginMode) {
    isLogin = loginMode;
    clearError();
    $('form-title').innerText = isLogin ? 'Login' : 'Register';
    $('form-sub').innerText = isLogin
        ? 'Welcome back. Sign in to manage your charging.'
        : 'Create your account and get \u20B91,000 starting wallet balance.';
    $('name-field').style.display = isLogin ? 'none' : 'block';
    $('submit-btn').innerText = isLogin ? 'Login' : 'Create account';
    $('toggle-text').innerText = isLogin ? 'New here?' : 'Already registered?';
    $('toggle-btn').innerText = isLogin ? 'Create an account' : 'Login instead';
    $('password').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
    $('tab-login').classList.toggle('active', isLogin);
    $('tab-register').classList.toggle('active', !isLogin);
}
function toggleForm() { setMode(!isLogin); }

function togglePassword() {
    const input = $('password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggle-pass').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

/* ---------- Submit ---------- */
$('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const email = $('email').value.trim();
    const password = $('password').value;
    const name = $('name').value.trim();
    const model = $('model').value.trim();

    if (!email || !password) return showError('Please enter your email and password.');
    if (!isLogin && !name) return showError('Please enter your full name.');

    const endpoint = isLogin ? '/api/login' : '/api/register';
    const bodyData = isLogin ? { email, password } : { name, model, email, password };

    const btn = $('submit-btn');
    const label = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Please wait...';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('ev_user', JSON.stringify(data.user));
            showToast(isLogin ? 'Signed in. Redirecting...' : 'Account created. Redirecting...', 'success', 1500);
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 600);
            return;
        }
        showError(data.message || 'Something went wrong. Please try again.');
    } catch (err) {
        console.error('Auth request failed:', err);
        showError('Cannot reach the server. Check that the backend is running.');
    }
    btn.disabled = false;
    btn.innerText = label;
});

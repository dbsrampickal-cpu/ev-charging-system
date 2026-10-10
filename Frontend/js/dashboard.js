/* ==========================================================================
   DASHBOARD LOGIC
   API used: /api/user/:id, /api/stations-nearby, /api/sessions/start|stop|active,
             /api/wallet/add|deduct, /api/user/update-battery
   ========================================================================== */

/* ---------- Auth guard ---------- */
let user = JSON.parse(localStorage.getItem('ev_user') || 'null');
if (!user) {
    window.location.replace('login.html');
}

/* ---------- Global state ---------- */
let activeSessionId = null;          // running session id
let chargingInterval = null;         // battery +1% every 2s while charging
let sessionClock = null;             // 1s UI timer for the session panel
let sessionStartedAt = null;         // Date.now() when charging started
let startBatteryLevel = 0;           // battery % when the session began
let currentBillData = null;          // latest invoice
let selectedCheckoutMethod = 'wallet';
let lastStations = [];               // last station payload (for client-side filtering)
let lastDistrict = '';
let stopping = false;                // guards double-click on "Stop charging"

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
const $ = (id) => document.getElementById(id);
const userId = () => user.id || user.Customer_ID;

/* ==========================================================================
   UTILITIES
   ========================================================================== */

/** Escapes a value for safe insertion into HTML (XSS protection). */
function escapeHTML(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const TOAST_ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
};
/** Non-blocking notification (replaces browser alert()). */
function showToast(message, type = 'info', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<svg class="t-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[type] || TOAST_ICONS.info}</svg><div style="white-space:pre-line"></div>`;
    el.lastElementChild.textContent = message;
    $('toast-root').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

const getBattery = () => parseInt($('battery-pct').innerText) || 0;
const money = (n) => parseFloat(n || 0).toFixed(2);

/** Updates the battery number, ring and status text together. */
function setBattery(value) {
    const pct = Math.max(0, Math.min(100, parseInt(value) || 0));
    $('battery-pct').innerText = pct;
    $('ring-bar').style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - pct / 100);

    const ring = $('ring');
    ring.classList.toggle('low', pct < 20);
    ring.classList.toggle('mid', pct >= 20 && pct < 50);
    ring.classList.toggle('charging', !!activeSessionId);

    if (activeSessionId) {
        $('battery-state').innerText = pct >= 100 ? 'Fully charged' : 'Charging';
        $('battery-hint').innerText = `+${Math.max(0, pct - startBatteryLevel)}% this session`;
    } else if (pct < 20) {
        $('battery-state').innerText = 'Low battery';
        $('battery-hint').innerText = 'Pick a nearby charger below';
    } else if (pct < 50) {
        $('battery-state').innerText = 'Moderate charge';
        $('battery-hint').innerText = 'Consider topping up soon';
    } else {
        $('battery-state').innerText = 'Healthy charge';
        $('battery-hint').innerText = 'Ready for your next trip';
    }
}

/** Binds the user object to every profile / wallet element. */
function updateUserData(u) {
    if (!u) return;
    const name = u.name || u.NAME || u.Name || 'User';
    const model = u.model || u.EV_MODEL || u.EV_Model || 'EV';
    const battery = u.battery !== undefined ? u.battery : (u.BATTERY_PERCENT !== undefined ? u.BATTERY_PERCENT : u.Battery_Percent);
    const balance = u.balance !== undefined ? u.balance : (u.BALANCE !== undefined ? u.BALANCE : u.Balance);

    $('cust-name').innerText = name;
    $('chip-name').innerText = name;
    $('greet-name').innerText = String(name).split(' ')[0];
    $('avatar').innerText = String(name).trim().charAt(0).toUpperCase() || 'U';
    $('ev-model').innerText = model;
    $('balance').innerText = money(balance);
    $('checkout-balance').innerText = money(balance);
    setBattery(battery);
}

/* ==========================================================================
   INITIAL LOAD
   ========================================================================== */
async function loadData() {
    updateUserData(user);          // instant paint from cache
    const district = $('district-filter').value;

    try {
        const [userRes, stationsRes, sessionRes] = await Promise.all([
            fetch(`/api/user/${userId()}`),
            fetch('/api/stations-nearby', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ district })
            }),
            fetch(`/api/sessions/active/${userId()}`)
        ]);

        const userData = await userRes.json();
        if (userData.success) {
            user = userData.user;
            localStorage.setItem('ev_user', JSON.stringify(user));
            updateUserData(user);
        }

        const stationsData = await stationsRes.json();
        renderStations(stationsData, district);

        const sessionData = await sessionRes.json();
        if (sessionData.success && sessionData.activeSession) {
            activeSessionId = sessionData.activeSession.session_id;
            if (startBatteryLevel === 0) startBatteryLevel = getBattery();
            showActiveSession(sessionData.activeSession.charger_id);
            startChargingLoop();
        } else {
            hideActiveSession();
        }
    } catch (err) {
        console.error('Failed to load initial dashboard data:', err);
        showToast('Could not load data from the server.', 'error');
        $('stations-list').innerHTML = emptyState('Unable to reach the server.');
    }
}

/* ==========================================================================
   STATIONS
   ========================================================================== */
const ICON_BOLT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2 4 13.5h6.2L9 22l10-12.2h-6.4z"/></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

function emptyState(msg) {
    return `<div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <p>${escapeHTML(msg)}</p></div>`;
}

/** Stores the payload then draws it (respecting the "available only" switch). */
function renderStations(data, district) {
    lastDistrict = district;
    lastStations = (data && data.success && Array.isArray(data.stations)) ? data.stations : [];
    applyStationView();
}

function applyStationView() {
    const onlyAvail = $('only-available').checked;
    let stations = lastStations;

    if (onlyAvail) {
        stations = stations
            .map(s => ({ ...s, chargers: s.chargers.filter(c => c.status === 'Available') }))
            .filter(s => s.chargers.length > 0);
    }

    const portCount = stations.reduce((n, s) => n + s.chargers.length, 0);
    $('station-count').innerText = lastStations.length
        ? `${stations.length} station${stations.length === 1 ? '' : 's'} \u00B7 ${portCount} port${portCount === 1 ? '' : 's'} shown`
        : 'Chargers across Kerala';

    if (!stations.length) {
        const where = lastDistrict === 'All' ? 'Kerala' : lastDistrict;
        $('stations-list').innerHTML = emptyState(
            onlyAvail && lastStations.length
                ? `No available ports right now in ${where}.`
                : `No stations are registered in ${where} yet.`
        );
        return;
    }

    $('stations-list').innerHTML = stations.map((s, i) => {
        const total = s.chargers.length;
        const free = s.chargers.filter(c => c.status === 'Available').length;
        const pct = total ? Math.round((free / total) * 100) : 0;

        const ports = s.chargers.map(c => {
            const status = String(c.status || '');
            const isFast = String(c.type).toLowerCase() === 'fast';
            const available = status === 'Available';
            return `
            <div class="port">
                <div class="port-head">
                    <span class="port-id">Port #${escapeHTML(c.id)}</span>
                    <span class="type-badge ${isFast ? 'type-fast' : 'type-standard'}">${isFast ? ICON_BOLT : ''}${escapeHTML(c.type)}</span>
                </div>
                <div class="rate">&#8377;${escapeHTML(c.rate)}<small> / kWh</small></div>
                <span class="status status-${escapeHTML(status.toLowerCase())}"><i></i>${escapeHTML(status)}</span>
                <button class="btn btn-sm" ${available ? '' : 'disabled'} onclick="startCharging('${escapeHTML(c.id)}', this)">${available ? 'Start charging' : 'In use'}</button>
            </div>`;
        }).join('');

        return `
        <article class="card station" style="animation-delay:${Math.min(i, 8) * 60}ms">
            <div class="station-top">
                <div>
                    <h3>${escapeHTML(s.name)}</h3>
                    <div class="loc">${ICON_PIN}<span>${escapeHTML(s.location)}</span></div>
                </div>
                <span class="district-pill">${escapeHTML(s.district)}</span>
            </div>
            <div class="avail"><span>${free}/${total} available</span><div class="bar"><i style="width:${pct}%"></i></div></div>
            <div class="ports">${ports}</div>
        </article>`;
    }).join('');
}

async function filterStationsByDistrict() {
    const district = $('district-filter').value;
    $('stations-list').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
        const res = await fetch('/api/stations-nearby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ district })
        });
        renderStations(await res.json(), district);
    } catch (err) {
        console.error('Failed to filter stations:', err);
        $('stations-list').innerHTML = emptyState('Unable to reach the server.');
        showToast('Failed to load stations.', 'error');
    }
}

/* ==========================================================================
   CHARGING SESSION
   ========================================================================== */
function findCharger(chargerId) {
    for (const s of lastStations) {
        const c = s.chargers.find(x => String(x.id) === String(chargerId));
        if (c) return { station: s, charger: c };
    }
    return null;
}

function showActiveSession(chargerId) {
    const found = findCharger(chargerId);
    $('session-title').innerText = found ? `Charging at ${found.station.name}` : 'Charging in progress';
    $('session-sub').innerText = `Session #${activeSessionId} \u00B7 Port #${chargerId}` +
        (found ? ` \u00B7 \u20B9${found.charger.rate}/kWh` : '');
    $('full-banner').style.display = 'none';
    $('session-section').style.display = 'block';

    if (!sessionStartedAt) sessionStartedAt = Date.now();
    if (sessionClock) clearInterval(sessionClock);
    sessionClock = setInterval(updateSessionMetrics, 1000);
    updateSessionMetrics();
    setBattery(getBattery());
}

function hideActiveSession() {
    $('session-section').style.display = 'none';
    if (sessionClock) clearInterval(sessionClock);
    sessionClock = null;
    sessionStartedAt = null;
}

function updateSessionMetrics() {
    if (!sessionStartedAt) return;
    const secs = Math.floor((Date.now() - sessionStartedAt) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const gain = Math.max(0, getBattery() - startBatteryLevel);
    $('m-time').innerText = `${mm}:${ss}`;
    $('m-gain').innerText = `+${gain}%`;
    $('m-kwh').innerText = `${(gain * 0.5).toFixed(2)} kWh`;
}

async function startCharging(chargerId, btn) {
    let originalText = '';
    if (btn) { originalText = btn.innerText; btn.disabled = true; btn.innerText = 'Connecting...'; }

    try {
        const res = await fetch('/api/sessions/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ charger_id: chargerId, user_id: userId() })
        });
        const data = await res.json();

        if (data.success) {
            activeSessionId = data.session.session_id;
            startBatteryLevel = getBattery();
            sessionStartedAt = Date.now();
            showActiveSession(chargerId);
            startChargingLoop();
            showToast('Charging started. Your battery is filling up.', 'success');
            $('session-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
            filterStationsByDistrict();   // refresh port availability
        } else {
            showToast(data.message || 'Could not start the session.', 'error');
            if (btn) { btn.disabled = false; btn.innerText = originalText; }
        }
    } catch (err) {
        console.error('Error starting session:', err);
        showToast('Failed to start charging. Check your network connection.', 'error');
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
}

/** Simulates charging hardware: +1% every 2 seconds, persisted to the DB. */
function startChargingLoop() {
    if (chargingInterval) clearInterval(chargingInterval);

    chargingInterval = setInterval(async () => {
        let battery = getBattery();

        if (battery < 100) {
            battery++;
            setBattery(battery);
            user.battery = battery;
            localStorage.setItem('ev_user', JSON.stringify(user));
            try {
                await fetch('/api/user/update-battery', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId(), battery })
                });
            } catch (err) {
                console.error('Error syncing battery level during charge loop:', err);
            }
        }

        if (battery >= 100) {
            clearInterval(chargingInterval);
            chargingInterval = null;
            $('full-banner').style.display = 'block';
            showToast('Battery is 100% charged. Stop charging to release the port.', 'success', 7000);
        }
    }, 2000);
}

async function stopCharging() {
    if (stopping || !activeSessionId) return;
    stopping = true;
    if (chargingInterval) { clearInterval(chargingInterval); chargingInterval = null; }

    const addedPercentage = Math.max(0, getBattery() - startBatteryLevel);
    // Each 1% of battery gained is assumed to use 0.5 kWh (minimum bill: 0.5 kWh)
    const energy = addedPercentage * 0.5;
    const finalKwh = energy > 0 ? energy : 0.5;

    try {
        const res = await fetch('/api/sessions/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: activeSessionId, energy_kwh: finalKwh, user_id: userId() })
        });
        const data = await res.json();

        if (data.success) {
            currentBillData = data.bill || {
                energy_kwh: finalKwh.toFixed(2),
                rate_per_kwh: '18.00',
                base_amount: (finalKwh * 18).toFixed(2),
                gst_amount: (finalKwh * 18 * 0.18).toFixed(2),
                total_billed: data.total_billed
            };
            activeSessionId = null;
            startBatteryLevel = 0;
            hideActiveSession();
            setBattery(getBattery());
            showBillModal(currentBillData);
            filterStationsByDistrict();
        } else {
            showToast(data.message || 'Could not stop the session.', 'error');
            if (activeSessionId) startChargingLoop();
        }
    } catch (err) {
        console.error('Error stopping charging session:', err);
        showToast('Failed to stop the session. Please try again.', 'error');
        if (activeSessionId) startChargingLoop();
    }
    stopping = false;
}

/* ==========================================================================
   MODALS (open/close helpers)
   ========================================================================== */
function openModal(id) { $(id).style.display = 'flex'; document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).style.display = 'none'; document.body.style.overflow = ''; }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay && overlay.id === 'wallet-modal') closeWalletModal();
    });
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('wallet-modal').style.display === 'flex') closeWalletModal();
});

/* ==========================================================================
   BILLING / CHECKOUT
   ========================================================================== */
function showBillModal(bill) {
    const kwhNum = parseFloat(bill.energy_kwh);
    $('bill-watts').innerText = Math.round(kwhNum * 1000);
    $('bill-kwh').innerText = bill.energy_kwh;
    $('bill-rate').innerText = `\u20B9${bill.rate_per_kwh} / kWh`;
    $('bill-base').innerText = `\u20B9${bill.base_amount}`;
    $('bill-gst').innerText = `\u20B9${bill.gst_amount}`;
    $('bill-total').innerText = `\u20B9${bill.total_billed}`;

    const upi = `upi://pay?pa=evstation@upi&pn=EV_Charging_Network&am=${bill.total_billed}&cu=INR`;
    $('gpay-checkout-qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upi)}`;

    selectCheckoutPayment('wallet');
    openModal('bill-modal');
}

function selectCheckoutPayment(method) {
    selectedCheckoutMethod = method;
    $('pay-opt-wallet').classList.toggle('active', method === 'wallet');
    $('pay-opt-gpay').classList.toggle('active', method === 'gpay');
    $('gpay-qr-checkout').style.display = method === 'gpay' ? 'block' : 'none';
}

async function processFinalPayment() {
    const totalBill = parseFloat(currentBillData.total_billed);
    const balance = parseFloat(user.balance || user.BALANCE || 0);

    if (selectedCheckoutMethod === 'wallet') {
        if (balance < totalBill) {
            showToast(`Insufficient wallet balance.\nYou have \u20B9${balance.toFixed(2)}; the bill is \u20B9${totalBill.toFixed(2)}.\nTop up your wallet or choose GPay/UPI.`, 'warn', 6500);
            return;
        }
        try {
            const res = await fetch('/api/wallet/deduct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId(), amount: totalBill })
            });
            const data = await res.json();
            if (data.success) {
                user = data.user;
                localStorage.setItem('ev_user', JSON.stringify(user));
                updateUserData(user);
                closeModal('bill-modal');
                showToast(`Payment of \u20B9${totalBill.toFixed(2)} deducted from your wallet.`, 'success');
            } else {
                showToast(data.message || 'Payment failed.', 'error');
            }
        } catch (err) {
            console.error('Wallet deduction error:', err);
            showToast('Payment failed. Please try again.', 'error');
        }
    } else {
        closeModal('bill-modal');
        showToast('GPay payment verified. Receipt generated.', 'success');
    }
}

/* ==========================================================================
   WALLET TOP-UP
   ========================================================================== */
function openWalletModal() { updateQrCode(); openModal('wallet-modal'); }
function closeWalletModal() { closeModal('wallet-modal'); }

function setTopup(amount) {
    $('topup-amount').value = amount;
    updateQrCode();
}

function syncQuickAmounts() {
    const val = parseFloat($('topup-amount').value);
    document.querySelectorAll('#quick-amounts .qa').forEach(b => {
        b.classList.toggle('active', parseFloat(b.innerText.replace(/[^\d.]/g, '')) === val);
    });
}

let debounceTimer;   // debounce so the QR API isn't hit on every keystroke
$('topup-amount').addEventListener('input', () => {
    syncQuickAmounts();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateQrCode, 300);
});

function updateQrCode() {
    syncQuickAmounts();
    const amount = $('topup-amount').value || '500';
    const upi = `upi://pay?pa=evnetwork@upi&pn=EV_Network_TopUp&am=${amount}&cu=INR`;
    $('upi-qr-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upi)}`;
}

async function addMoneyToWallet() {
    const amount = parseFloat($('topup-amount').value);
    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount.', 'warn');
        return;
    }
    try {
        const res = await fetch('/api/wallet/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId(), amount })
        });
        const data = await res.json();
        if (data.success) {
            user = data.user;
            localStorage.setItem('ev_user', JSON.stringify(user));
            updateUserData(user);
            closeWalletModal();
            showToast(`Added \u20B9${amount.toFixed(2)} to your wallet.`, 'success');
        } else {
            showToast(data.message || 'Could not add funds.', 'error');
        }
    } catch (err) {
        console.error('Error adding funds to wallet:', err);
        showToast('Could not add funds. Please try again.', 'error');
    }
}

/* ==========================================================================
   LIFECYCLE
   ========================================================================== */
function logout() {
    if (chargingInterval) clearInterval(chargingInterval);
    if (sessionClock) clearInterval(sessionClock);
    localStorage.removeItem('ev_user');
    window.location.href = 'login.html';
}

if (user) loadData();

/** Idle drain: -1% every 15s while the vehicle is not charging. */
setInterval(async () => {
    if (!user || activeSessionId) return;
    const battery = getBattery();
    if (battery > 0) {
        const next = battery - 1;
        setBattery(next);
        user.battery = next;
        localStorage.setItem('ev_user', JSON.stringify(user));
        try {
            await fetch('/api/user/update-battery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId(), battery: next })
            });
        } catch (err) {
            console.error('Sync error during background battery drain:', err);
        }
    }
}, 15000);

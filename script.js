const AUTH_URL = "/api/auth";

// ===== DEVICE ID =====
function getDeviceId() {
  let id = localStorage.getItem('amprem_device');
  if (!id) {
    const fp = [navigator.userAgent, screen.width, new Date().getTimezoneOffset()].join('|');
    const hash = [...fp].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    id = 'dev_' + Math.abs(hash).toString(36);
    localStorage.setItem('amprem_device', id);
  }
  return id;
}

async function authAPI(action, payload = {}) {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, deviceId: getDeviceId(), ...payload })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.message || `Request gagal (${res.status})`);
  }
  return data;
}

let currentUser = null;
let adCount = 0;
const AD_TARGET = 5;

// ===== TABS =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('loginForm').classList.toggle('active', tab === 'login');
    document.getElementById('registerForm').classList.toggle('active', tab === 'register');
    document.getElementById('loginError').classList.remove('show');
    document.getElementById('registerError').classList.remove('show');
  });
});

// ===== LOGIN =====
document.getElementById('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errDiv = document.getElementById('loginError');
  const btn = e.target.querySelector('button');

  errDiv.classList.remove('show'); btn.disabled = true; btn.innerHTML = 'Memeriksa...';

  try {
    const res = await authAPI('login', { username, password });
    currentUser = res.user;
    sessionStorage.setItem('amprem_user', JSON.stringify({ username: currentUser.username, role: currentUser.role }));
    enterApp();
  } catch (err) {
    errDiv.textContent = err.message; errDiv.classList.add('show');
  } finally {
    btn.disabled = false; btn.innerHTML = 'Masuk <b>→</b>';
  }
};

// ===== REGISTER =====
document.getElementById('registerForm').onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const password2 = document.getElementById('regPassword2').value;
  const errDiv = document.getElementById('registerError');
  const btn = e.target.querySelector('button');

  errDiv.classList.remove('show');
  if (password !== password2) {
    errDiv.textContent = 'Konfirmasi password tidak cocok'; errDiv.classList.add('show'); return;
  }

  btn.disabled = true; btn.innerHTML = 'Membuat akun...';

  try {
    const res = await authAPI('register', { username, password, email });
    currentUser = res.user;
    sessionStorage.setItem('amprem_user', JSON.stringify({ username: currentUser.username, role: currentUser.role }));
    alert('✅ Akun berhasil dibuat! Selamat datang, ' + username);
    enterApp();
  } catch (err) {
    errDiv.textContent = err.message; errDiv.classList.add('show');
  } finally {
    btn.disabled = false; btn.innerHTML = 'Daftar Sekarang <b>→</b>';
  }
};

// ===== ENTER APP =====
function enterApp() {
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('appScreen').style.display = 'block';
  
  const badge = document.getElementById('roleBadge');
  if (currentUser.role === 'reseller') {
    badge.textContent = '⭐ RESELLER'; badge.classList.add('reseller');
  } else {
    badge.textContent = 'FREE — Wajib 5 iklan'; badge.classList.remove('reseller');
  }
}

// ===== AUTO LOGIN =====
window.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('amprem_user');
  if (saved) {
    try { currentUser = JSON.parse(saved); if (currentUser?.username) enterApp(); } catch {}
  }
});

function logout() {
  sessionStorage.removeItem('amprem_user');
  currentUser = null;
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
}
window.logout = logout;

// ===== STEP LOGIC =====
function showStep(stepId) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('show'));
  document.getElementById(stepId).classList.add('show');
  const steps = ['emailStep', 'adStep', 'verifyStep', 'successStep'];
  const idx = steps.indexOf(stepId);
  document.querySelectorAll('.progress i').forEach((bar, i) => bar.classList.toggle('on', i <= idx));
}

// ===== EMAIL -> IKLAN =====
document.getElementById('emailForm').onsubmit = (e) => {
  e.preventDefault();
  if (currentUser.role === 'reseller') {
    showStep('verifyStep'); // Reseller langsung loncat
  } else {
    adCount = 0;
    document.getElementById('adCount').textContent = '0';
    document.getElementById('finishAdsBtn').disabled = true;
    document.getElementById('finishAdsBtn').style.opacity = '0.5';
    document.getElementById('watchAdBtn').disabled = false;
    document.getElementById('watchAdBtn').textContent = 'Tonton Iklan (Klik)';
    showStep('adStep');
  }
};

// ===== TONTON IKLAN =====
document.getElementById('watchAdBtn').onclick = () => {
  if (adCount >= AD_TARGET) return;
  
  // GANTI LINK DI BAWAH DENGAN LINK ADSTERRA ANDA
  const ADSTERRA_LINK = 'https://www.effectivegatecpm.com/xxxxxx'; 
  window.open(ADSTERRA_LINK, '_blank');

  adCount++;
  document.getElementById('adCount').textContent = adCount;

  if (adCount >= AD_TARGET) {
    document.getElementById('finishAdsBtn').disabled = false;
    document.getElementById('finishAdsBtn').style.opacity = '1';
    document.getElementById('watchAdBtn').disabled = true;
    document.getElementById('watchAdBtn').textContent = '✅ Selesai (5/5)';
  }
};

document.getElementById('finishAdsBtn').onclick = () => {
  if (adCount >= AD_TARGET) showStep('verifyStep');
};

// ===== VERIFIKASI =====
document.getElementById('verifyForm').onsubmit = async (e) => {
  e.preventDefault();
  showStep('successStep');
};

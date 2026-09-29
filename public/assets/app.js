const $ = (id) => document.getElementById(id);

function getAdminPassword() {
  return (sessionStorage.getItem('adminPassword') || '').trim();
}

async function api(url, opt = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opt.headers || {})
  };

  const password = getAdminPassword();
  if (password) {
    headers['x-admin-password'] = password;
  }

  const response = await fetch(url, {
    ...opt,
    headers
  });

  const data = await response.json().catch(() => ({
    message: 'Respons server tidak valid'
  }));

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('adminPassword');
    }
    throw new Error(data.message || 'Terjadi kesalahan');
  }

  return data;
}

async function loginAdmin(password) {
  password = String(password || '').trim();

  if (!password) {
    throw new Error('Masukkan password admin.');
  }

  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password })
  });

  const data = await response.json().catch(() => ({
    message: 'Respons server tidak valid'
  }));

  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Password admin salah.');
  }

  sessionStorage.setItem('adminPassword', password);
  return data;
}

function logoutAdmin() {
  sessionStorage.removeItem('adminPassword');
}

function notice(id, msg, ok = true) {
  const e = $(id);
  if (!e) return;
  e.textContent = msg;
  e.className = 'notice show ' + (ok ? 'ok' : 'err');
}

function nav(active) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === active);
  });
}

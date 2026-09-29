require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Resend } = require('resend');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'attendance.json');

const sessions = new Map();

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'admin').trim();

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

console.log('');
console.log('================================');
console.log('         ABSENSI X TKJ');
console.log('================================');
console.log(`PORT           : ${PORT}`);
console.log(`ADMIN PASSWORD : ${ADMIN_PASSWORD ? 'TERBACA' : 'TIDAK ADA'}`);
console.log('================================');
console.log('');

function readAttendance() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Gagal membaca attendance.json:', error.message);
    return [];
  }
}

function writeAttendance(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

function getAdminPassword(req) {
  return String(
    req.headers['x-admin-password'] ||
    req.body?.adminPassword ||
    req.body?.password ||
    req.query?.adminPassword ||
    ''
  ).trim();
}

function adminOnly(req, res, next) {
  const password = getAdminPassword(req);

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      ok: false,
      message: 'Password admin salah.'
    });
  }

  next();
}

function safeText(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[c]
  );
}

/* Login admin */
app.post('/api/admin/login', (req, res) => {
  const password = String(req.body?.password || '').trim();

  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      ok: false,
      message: 'Password admin salah.'
    });
  }

  res.json({
    ok: true,
    message: 'Login admin berhasil.'
  });
});

app.get('/api/admin/check', adminOnly, (req, res) => {
  res.json({
    ok: true,
    message: 'Admin terverifikasi.'
  });
});

/* Sesi QR */
app.post('/api/session', adminOnly, async (req, res) => {
  try {
    const duration = Math.min(
      Math.max(Number(req.body?.duration || 60), 1),
      720
    );

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + duration * 60 * 1000;

    const baseUrl = (
      process.env.BASE_URL ||
      `${req.protocol}://${req.get('host')}`
    ).replace(/\/$/, '');

    const attendanceUrl = `${baseUrl}/absen.html?token=${token}`;

    const qrDataUrl = await QRCode.toDataURL(attendanceUrl, {
      width: 520,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    sessions.set(token, {
      token,
      expiresAt,
      createdAt: Date.now(),
      attendanceUrl
    });

    res.json({
      ok: true,
      token,
      expiresAt,
      attendanceUrl,
      qrDataUrl
    });
  } catch (error) {
    console.error('SESSION ERROR:', error);
    res.status(500).json({
      ok: false,
      message: 'Gagal membuat sesi absensi.'
    });
  }
});

app.get('/api/session/:token', (req, res) => {
  const session = sessions.get(req.params.token);

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({
      ok: false,
      message: 'QR sudah kedaluwarsa.'
    });
  }

  res.json({
    ok: true,
    expiresAt: session.expiresAt
  });
});

/* Absensi siswa */
app.post('/api/attendance', async (req, res) => {
  try {
    const token = safeText(req.body?.token, 100);
    const name = safeText(req.body?.name, 80);
    const kelas = safeText(req.body?.kelas, 50);
    const status = safeText(req.body?.status, 20) || 'Hadir';
    const note = safeText(req.body?.note, 200);

    const session = sessions.get(token);

    if (!session || Date.now() > session.expiresAt) {
      return res.status(400).json({
        ok: false,
        message: 'QR sudah kedaluwarsa. Minta QR baru.'
      });
    }

    if (!name || !kelas) {
      return res.status(400).json({
        ok: false,
        message: 'Nama dan kelas wajib diisi.'
      });
    }

    const rows = readAttendance();

    const today = new Date().toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta'
    });

    const duplicate = rows.find(
      (row) =>
        row.token === token &&
        String(row.name).toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      return res.status(409).json({
        ok: false,
        message: 'Nama tersebut sudah melakukan absensi pada sesi ini.'
      });
    }

    const record = {
      id: crypto.randomUUID(),
      name,
      kelas,
      status,
      note,
      date: today,
      time: new Date().toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta'
      }),
      timestamp: new Date().toISOString(),
      token
    };

    rows.unshift(record);
    writeAttendance(rows);

    let emailSent = false;

    if (resend && process.env.ADMIN_EMAIL && process.env.MAIL_FROM) {
      try {
        const { error } = await resend.emails.send({
          from: process.env.MAIL_FROM,
          to: [process.env.ADMIN_EMAIL],
          subject: `Absensi baru — ${name}`,
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6">
              <h2>Absensi Baru</h2>
              <p><b>Nama:</b> ${escapeHtml(name)}</p>
              <p><b>Kelas:</b> ${escapeHtml(kelas)}</p>
              <p><b>Status:</b> ${escapeHtml(status)}</p>
              <p><b>Waktu:</b> ${escapeHtml(record.date)} ${escapeHtml(record.time)} WIB</p>
              ${note ? `<p><b>Keterangan:</b> ${escapeHtml(note)}</p>` : ''}
            </div>
          `
        });

        emailSent = !error;
      } catch (error) {
        console.error('RESEND ERROR:', error.message);
      }
    }

    res.json({
      ok: true,
      message: 'Absensi berhasil dicatat.',
      emailSent
    });
  } catch (error) {
    console.error('ATTENDANCE ERROR:', error);
    res.status(500).json({
      ok: false,
      message: 'Gagal menyimpan absensi.'
    });
  }
});

/* Data admin */
app.get('/api/attendance', adminOnly, (req, res) => {
  res.json({
    ok: true,
    rows: readAttendance()
  });
});

app.get('/api/stats', adminOnly, (req, res) => {
  const rows = readAttendance();

  const today = new Date().toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta'
  });

  const todayRows = rows.filter((row) => row.date === today);

  res.json({
    ok: true,
    total: todayRows.length,
    hadir: todayRows.filter((row) => row.status === 'Hadir').length,
    izin: todayRows.filter((row) => row.status === 'Izin').length,
    sakit: todayRows.filter((row) => row.status === 'Sakit').length
  });
});

app.get('/api/export', adminOnly, (req, res) => {
  const rows = readAttendance();

  const headers = [
    'Nama',
    'Kelas',
    'Status',
    'Tanggal',
    'Waktu',
    'Keterangan'
  ];

  const csv = [
    headers,
    ...rows.map((row) => [
      row.name,
      row.kelas,
      row.status,
      row.date,
      row.time,
      row.note
    ])
  ]
    .map((row) =>
      row
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="absensi-kelas.csv"'
  );

  res.send('\ufeff' + csv);
});

/* Frontend */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Absensi berjalan di http://localhost:${PORT}`);
});

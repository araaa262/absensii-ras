# Absensi X TKJ

Website absensi QR berbasis Express + QRCode + Resend.

## Menjalankan di VS Code

```bash
npm install
npm start
```

Buka:

http://localhost:3000

Password admin default dari `.env`:

```text
admin
```

## File environment

Buat `.env` di root project. Contoh tersedia di `.env.example`.

`.env` sengaja masuk `.gitignore` agar password dan API key tidak ikut GitHub.

## Penting

Jika `.env` pernah terlanjur di-commit ke GitHub, `.gitignore` tidak otomatis menghapusnya dari Git. Hapus file tersebut dari tracking Git lalu lakukan commit.

```bash
git rm --cached .env
git add .gitignore .env.example
git commit -m "amankan file env"
git push
```

Jika API key Resend pernah terbuka/publik, buat API key baru di Resend.

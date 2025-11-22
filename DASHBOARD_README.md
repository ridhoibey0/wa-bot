# Dashboard WhatsApp Bot - Dokumentasi

## 🎉 Dashboard Sudah Dibuat!

Dashboard web telah berhasil dibuat dengan fitur lengkap untuk manajemen WhatsApp Bot.

## 📋 Fitur Dashboard

### 1. **Authentication**
- Login dengan username & password
- Session management
- Default credentials: `admin` / `admin123`

### 2. **Dashboard Home**
- Statistik total users
- Statistik total menus
- Statistik total pendaftaran
- Statistik pembayaran

### 3. **QR Code Scanner**
- Scan QR code WhatsApp langsung dari browser
- Auto refresh setiap 30 detik
- Tampilan visual yang user-friendly

### 4. **Users Management**
- Lihat semua users terdaftar
- Tambah user baru
- Hapus user
- Filter dan pencarian

### 5. **Menus Management**
- Lihat semua menu makanan
- Tambah menu baru
- Edit menu (nama & harga)
- Hapus menu

### 6. **Gathering Data**
- Lihat semua pendaftaran gathering
- Total pendapatan
- Status pembayaran (Paid/Pending)
- Mark as paid
- Rincian biaya per peserta
- Hapus data

### 7. **Muted Users Management**
- Lihat daftar user yang di-mute
- Unmute user
- Log pesan yang dihapus (50 terakhir)

## 🚀 Cara Menggunakan

### 1. Jalankan Aplikasi
```bash
npm install
node index.js
```

### 2. Akses Dashboard
Buka browser dan kunjungi: `http://localhost:3000`

### 3. Login
- Username: `admin`
- Password: `admin123`

### 4. Scan QR Code
- Klik menu "QR Code" di sidebar
- Scan QR code dengan WhatsApp di HP Anda
- Bot akan otomatis connect

## 📱 Fitur Bot Baru

### Command: `!groupid` atau `!idgrup`
Menampilkan informasi ID grup (untuk konfigurasi morning greeting)

**Cara pakai:**
1. Ketik `!groupid` atau `!idgrup` di grup WhatsApp
2. Bot akan reply dengan nama grup dan ID grup
3. Copy ID grup tersebut untuk digunakan di `.env`

### Morning Greeting ke Multiple Groups
Bot sekarang bisa mengirim voice note "Selamat pagi" ke beberapa grup sekaligus!

**Setup di `.env`:**
```env
# Single group
MORNING_GROUP_IDS=120363402403833771@g.us

# Multiple groups (pisahkan dengan koma)
MORNING_GROUP_IDS=120363402403833771@g.us,120987654321098@g.us,120111222333444@g.us

# Waktu pengiriman (format cron)
MORNING_TIME=0 7 * * *
```

**Format waktu cron:**
- `0 7 * * *` = Jam 07:00 setiap hari
- `30 6 * * *` = Jam 06:30 setiap hari
- `0 8 * * 1-5` = Jam 08:00 Senin-Jumat
- `0 9 * * 0,6` = Jam 09:00 Sabtu & Minggu

## 🎨 Struktur File

```
wa-bot/
├── routes/
│   └── dashboard.js          # Semua routes dashboard
├── views/
│   ├── login.ejs            # Halaman login
│   ├── dashboard.ejs        # Dashboard home
│   ├── qr.ejs              # QR code scanner
│   ├── users.ejs           # User management
│   ├── menus.ejs           # Menu management
│   ├── gathering.ejs       # Gathering data
│   └── muted.ejs           # Muted users
├── public/
│   └── css/
│       └── style.css        # Styling dashboard
└── index.js                 # Main app dengan integrasi dashboard
```

## 🔐 Keamanan

**PENTING:** Ganti password default sebelum production!

Edit file `routes/dashboard.js` bagian login:
```javascript
// Ganti ini dengan database authentication atau minimal ganti password
if (username === "admin" && password === "GANTI_PASSWORD_KAMU") {
  // ...
}
```

Atau tambahkan `SESSION_SECRET` di `.env`:
```env
SESSION_SECRET=random-string-yang-sangat-panjang-dan-aman
```

## 📊 Endpoint Dashboard

- `/` - Redirect ke login atau dashboard
- `/login` - Halaman login
- `/logout` - Logout
- `/dashboard` - Dashboard home
- `/qr` - QR code scanner
- `/users` - User management
- `/menus` - Menu management
- `/gathering` - Gathering data
- `/muted` - Muted users management

## 🛠️ Development

### Update Dashboard Routes
Edit `routes/dashboard.js` untuk menambah/edit routes

### Update Views
Edit file `.ejs` di folder `views/` untuk mengubah tampilan

### Update Styling
Edit `public/css/style.css` untuk mengubah styling

## 📝 Catatan Deploy

Jika deploy di production:
1. Ganti password default admin
2. Set `SESSION_SECRET` di `.env` dengan string random yang aman
3. Gunakan HTTPS dengan SSL certificate
4. Setup firewall untuk port 3000 atau gunakan Nginx reverse proxy
5. Set `cookie: { secure: true }` di session config untuk HTTPS

## 🐛 Troubleshooting

### Dashboard tidak muncul
- Pastikan dependencies sudah terinstall: `npm install`
- Cek apakah port 3000 sudah digunakan
- Lihat logs untuk error: `pm2 logs wa-bot`

### QR Code tidak muncul
- Pastikan bot sudah berjalan
- Pastikan file `whatsapp.qr` ada
- Refresh halaman atau restart bot

### Session expired terus
- Cek `SESSION_SECRET` di `.env`
- Increase `maxAge` di session config di `index.js`

## 📞 Command Bot Lengkap

| Command | Deskripsi | Admin Only |
|---------|-----------|------------|
| `!tagall` | Mention semua member grup | ❌ |
| `!groupid` atau `!idgrup` | Cek ID grup | ❌ |
| `ulang [n]` | Ulang pesan yang di-reply n kali | ❌ |
| `do [prompt]` | AI Assistant (Gemini) | ✅ |
| `silent him` | Mute user (reply pesannya) | ✅ |
| `unsilent him` | Unmute user (reply pesannya) | ✅ |
| `kick him` | Kick user dari grup | ✅ |

---

**Selamat menggunakan WhatsApp Bot Dashboard! 🎉**

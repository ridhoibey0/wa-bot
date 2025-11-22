# Panduan Deploy WhatsApp Bot di Ubuntu Server

## Persiapan Server

### 1. Update sistem
```bash
sudo apt update
sudo apt upgrade -y
```

### 2. Install Node.js dan npm
```bash
# Install Node.js 18.x (atau versi LTS terbaru)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi instalasi
node --version
npm --version
```

### 3. Install PostgreSQL
```bash
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Buat database dan user
sudo -u postgres psql

# Di dalam psql prompt:
CREATE DATABASE gathering;
CREATE USER your_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE gathering TO your_user;
\q
```

### 4. Install dependensi sistem untuk Puppeteer
```bash
# Untuk Ubuntu 24.04 LTS dan versi baru
sudo apt install -y \
  ca-certificates \
  fonts-liberation \
  libasound2t64 \
  libatk-bridge2.0-0t64 \
  libatk1.0-0t64 \
  libc6 \
  libcairo2 \
  libcups2t64 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libglib2.0-0t64 \
  libgtk-3-0t64 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils

# ATAU untuk Ubuntu 22.04 LTS dan versi lama, gunakan:
# sudo apt install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
#   libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
#   libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
#   libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
#   libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
#   libxss1 libxtst6 lsb-release wget xdg-utils
```

## Setup Aplikasi

### 1. Clone atau upload project
```bash
# Jika menggunakan git:
cd /home/your_user
git clone https://github.com/ridhoibey0/wa-bot.git
cd wa-bot

# Atau upload manual menggunakan scp/sftp
# scp -r /path/to/wa-bot user@server:/home/your_user/
```

### 2. Install dependencies
```bash
npm install
```

### 3. Setup environment variables
```bash
nano .env
```

Isi file `.env`:
```env
DB_HOST=localhost
DB_NAME=gathering
DB_USER=your_user
DB_PASSWORD=your_password
GEMINI_API_KEY=your_gemini_api_key

# ID Grup untuk morning greeting (pisahkan dengan koma untuk multiple groups)
MORNING_GROUP_IDS=120363402403833771@g.us
# Waktu pengiriman (format cron: menit jam * * *)
MORNING_TIME=0 7 * * *

# Session secret untuk dashboard (GANTI dengan random string yang aman!)
SESSION_SECRET=ganti-dengan-random-string-yang-panjang-dan-aman
```

**PENTING untuk Production:**
- Ganti `SESSION_SECRET` dengan string random yang panjang
- Ganti password default admin di `routes/dashboard.js`

### 4. Jalankan database migrations
```bash
npx knex migrate:latest
```

## Setup PM2 untuk Production

### 1. Install PM2
```bash
sudo npm install -g pm2
```

### 2. Buat file ecosystem untuk PM2
```bash
nano ecosystem.config.js
```

Isi file `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'wa-bot',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### 3. Buat folder logs
```bash
mkdir logs
```

### 4. Start aplikasi dengan PM2
```bash
pm2 start ecosystem.config.js

# Untuk melihat status
pm2 status

# Untuk melihat logs
pm2 logs wa-bot

# Untuk restart
pm2 restart wa-bot

# Untuk stop
pm2 stop wa-bot
```

### 5. Setup PM2 startup (agar bot auto-start setelah reboot)
```bash
pm2 startup
# Copy dan jalankan command yang muncul

# Simpan daftar aplikasi PM2
pm2 save
```

## Akses Dashboard & Scan QR Code

### Akses Dashboard
1. Buka browser dan akses `http://server_ip:3000` (contoh: `http://178.128.208.9:3000`)
2. Login dengan credentials:
   - Username: `admin`
   - Password: `admin123`
3. Dashboard akan menampilkan statistik dan menu navigasi

### Scan QR Code WhatsApp
**Metode 1: Melalui Dashboard (Recommended)**
1. Login ke dashboard
2. Klik menu "📱 QR Code" di sidebar
3. Scan QR code yang muncul dengan WhatsApp di HP Anda
4. QR code akan auto-refresh setiap 30 detik

**Metode 2: Melalui SSH terminal**
1. QR code akan muncul di terminal saat pertama kali dijalankan
2. Scan QR code tersebut dengan WhatsApp di HP Anda

**Tips:** Gunakan dashboard untuk experience yang lebih baik dan mudah.

## Setup Firewall (Optional tapi Disarankan)

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow port aplikasi (WAJIB untuk akses dashboard dari public)
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

**PENTING:** Pastikan port 3000 terbuka agar dashboard bisa diakses dari luar!

## Setup Nginx sebagai Reverse Proxy (Optional)

### 1. Install Nginx
```bash
sudo apt install -y nginx
```

### 2. Konfigurasi Nginx
```bash
sudo nano /etc/nginx/sites-available/wa-bot
```

Isi konfigurasi:
```nginx
server {
    listen 80;
    server_name your_domain.com;  # atau IP server

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Enable konfigurasi
```bash
sudo ln -s /etc/nginx/sites-available/wa-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**Dengan Nginx:** Akses dashboard via `http://your_domain.com` atau `http://178.128.208.9`  
**Tanpa Nginx:** Akses dashboard via `http://178.128.208.9:3000`

## Monitoring dan Maintenance

### Melihat logs
```bash
# PM2 logs
pm2 logs wa-bot

# Atau dari file
tail -f logs/combined.log
```

### Monitoring resource
```bash
pm2 monit
```

### Update aplikasi
```bash
cd /home/your_user/wa-bot
git pull  # jika menggunakan git
npm install  # jika ada dependency baru
pm2 restart wa-bot
```

### Backup database
```bash
# Backup
pg_dump -U your_user gathering > backup_$(date +%Y%m%d).sql

# Restore
psql -U your_user gathering < backup_20250121.sql
```

## Troubleshooting

### Bot tidak bisa connect
- Pastikan semua dependensi Puppeteer terinstall
- Cek logs: `pm2 logs wa-bot`
- Restart aplikasi: `pm2 restart wa-bot`

### QR code tidak muncul di browser
- Pastikan port 3000 terbuka di firewall
- Cek apakah aplikasi berjalan: `pm2 status`
- Cek logs untuk error: `pm2 logs wa-bot`

### Database connection error
- Pastikan PostgreSQL berjalan: `sudo systemctl status postgresql`
- Cek kredensial di file `.env`
- Pastikan database dan user sudah dibuat

### Memory issues
- Increase max_memory_restart di `ecosystem.config.js`
- Monitor dengan: `pm2 monit`
- Restart aplikasi secara berkala menggunakan cron

### Session terputus
- Session WhatsApp disimpan di `.wwebjs_auth`
- Jangan hapus folder ini kecuali ingin re-authenticate
- Backup folder ini secara berkala

## Tips Keamanan

1. **Jangan expose port 3000 ke public** jika tidak perlu
2. **Gunakan environment variables** untuk semua credential
3. **Setup SSL/HTTPS** jika menggunakan domain
4. **Update sistem secara berkala**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
5. **Setup automatic backup** untuk database dan session
6. **Batasi akses SSH** hanya dari IP tertentu jika memungkinkan

## Commands Cheat Sheet

```bash
# PM2
pm2 start ecosystem.config.js    # Start aplikasi
pm2 restart wa-bot               # Restart aplikasi
pm2 stop wa-bot                  # Stop aplikasi
pm2 delete wa-bot                # Hapus dari PM2
pm2 logs wa-bot                  # Lihat logs
pm2 monit                        # Monitor resource
pm2 list                         # List semua aplikasi

# PostgreSQL
sudo systemctl status postgresql # Check status
sudo systemctl restart postgresql # Restart PostgreSQL
sudo -u postgres psql            # Akses PostgreSQL

# Nginx
sudo systemctl status nginx      # Check status
sudo systemctl restart nginx     # Restart Nginx
sudo nginx -t                    # Test konfigurasi

# System
htop                            # Monitor sistem
df -h                           # Check disk space
free -m                         # Check memory
```

## Automation dengan Cron (Optional)

### Auto restart bot setiap hari jam 3 pagi
```bash
crontab -e

# Tambahkan:
0 3 * * * pm2 restart wa-bot
```

### Auto backup database setiap hari
```bash
crontab -e

# Tambahkan:
0 2 * * * pg_dump -U your_user gathering > /home/your_user/backups/gathering_$(date +\%Y\%m\%d).sql
```

---

**Catatan:** Ganti `your_user`, `your_password`, `your_domain.com`, dan parameter lainnya sesuai dengan setup Anda.

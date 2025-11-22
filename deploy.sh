#!/bin/bash

# Script untuk deploy WhatsApp Bot di Ubuntu
# Jalankan dengan: bash deploy.sh

echo "==================================="
echo "WhatsApp Bot Deployment Script"
echo "==================================="
echo ""

# Warna untuk output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Fungsi untuk print dengan warna
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    print_error "Jangan jalankan script ini sebagai root!"
    exit 1
fi

# Update sistem
print_info "Updating sistem..."
sudo apt update && sudo apt upgrade -y
print_success "Sistem berhasil diupdate"

# Install Node.js
print_info "Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
    print_success "Node.js berhasil diinstall"
else
    print_info "Node.js sudah terinstall: $(node --version)"
fi

# Install PostgreSQL
print_info "Installing PostgreSQL..."
if ! command -v psql &> /dev/null; then
    sudo apt install -y postgresql postgresql-contrib
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
    print_success "PostgreSQL berhasil diinstall"
else
    print_info "PostgreSQL sudah terinstall"
fi

# Install Puppeteer dependencies
print_info "Installing Puppeteer dependencies..."
sudo apt install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
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
print_success "Puppeteer dependencies berhasil diinstall"

# Setup database
print_info "Setting up database..."
read -p "Nama database [gathering]: " DB_NAME
DB_NAME=${DB_NAME:-gathering}

read -p "Username database [wabot]: " DB_USER
DB_USER=${DB_USER:-wabot}

read -sp "Password database: " DB_PASSWORD
echo ""

# Create database
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME;" 2>/dev/null
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null
print_success "Database berhasil dibuat"

# Install dependencies
print_info "Installing npm dependencies..."
npm install
print_success "Dependencies berhasil diinstall"

# Create .env file
print_info "Creating .env file..."
read -p "Gemini API Key: " GEMINI_KEY
read -p "ID Grup untuk morning greeting: " GROUP_ID
read -p "Waktu morning greeting (format cron) [0 7 * * *]: " MORNING_TIME
MORNING_TIME=${MORNING_TIME:-"0 7 * * *"}

cat > .env << EOF
DB_HOST=localhost
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
GEMINI_API_KEY=$GEMINI_KEY

# ID Grup untuk morning greeting (format: 120363402403833771@g.us)
MORNING_GROUP_ID=$GROUP_ID
# Waktu pengiriman (format cron: menit jam * * *)
MORNING_TIME=$MORNING_TIME
EOF
print_success ".env file berhasil dibuat"

# Run migrations
print_info "Running database migrations..."
npx knex migrate:latest
print_success "Migrations berhasil dijalankan"

# Create logs directory
mkdir -p logs
print_success "Logs directory berhasil dibuat"

# Install PM2
print_info "Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    print_success "PM2 berhasil diinstall"
else
    print_info "PM2 sudah terinstall"
fi

# Setup PM2 startup
print_info "Setting up PM2 startup..."
pm2 startup | tail -n 1 | sudo bash
print_success "PM2 startup berhasil disetup"

# Start aplikasi
print_info "Starting aplikasi dengan PM2..."
pm2 start ecosystem.config.js
pm2 save
print_success "Aplikasi berhasil distart"

echo ""
echo "==================================="
print_success "Deployment selesai!"
echo "==================================="
echo ""
print_info "Langkah selanjutnya:"
echo "1. Akses http://$(hostname -I | awk '{print $1}'):3000 untuk scan QR code"
echo "2. Scan QR code dengan WhatsApp di HP Anda"
echo "3. Gunakan 'pm2 logs wa-bot' untuk melihat logs"
echo "4. Gunakan 'pm2 status' untuk melihat status aplikasi"
echo ""
print_info "Command berguna:"
echo "- pm2 restart wa-bot  : Restart aplikasi"
echo "- pm2 stop wa-bot     : Stop aplikasi"
echo "- pm2 logs wa-bot     : Lihat logs"
echo "- pm2 monit           : Monitor resource"
echo ""

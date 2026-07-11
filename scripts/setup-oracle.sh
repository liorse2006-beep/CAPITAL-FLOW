#!/bin/bash
# One-time setup for Oracle Cloud Always Free Ubuntu 22.04 ARM VM.
# Run as: bash setup-oracle.sh
set -euo pipefail

REPO="https://github.com/liorse2006-beep/CAPITAL-FLOW.git"
APP_DIR="$HOME/capital-flow"

echo "==> [1/6] Installing Docker..."
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

echo "==> [2/6] Installing Nginx + Certbot..."
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends nginx certbot python3-certbot-nginx

echo "==> [3/6] Opening firewall ports (Oracle iptables)..."
# Oracle VMs have an iptables chain that blocks all ports by default.
# These rules let HTTP/HTTPS through so Nginx can serve traffic.
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 7 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo apt-get install -y iptables-persistent

echo "==> [4/6] Cloning repository..."
if [ -d "$APP_DIR" ]; then
  echo "    Directory already exists — pulling latest..."
  cd "$APP_DIR" && git pull origin master
else
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "==> [5/6] Creating .env file..."
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo ""
  echo "  !! IMPORTANT: Fill in your production secrets now:"
  echo "     nano $APP_DIR/.env"
  echo ""
else
  echo "    .env already exists — skipping."
fi

echo "==> [6/6] Setting up Nginx..."
sudo cp "$APP_DIR/nginx/capital-flow.conf" /etc/nginx/sites-available/capital-flow
sudo ln -sf /etc/nginx/sites-available/capital-flow /etc/nginx/sites-enabled/capital-flow
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit secrets:   nano $APP_DIR/.env"
echo "  2. Start the app:  cd $APP_DIR && docker compose up -d --build"
echo "  3. (Optional) Add a domain + SSL:"
echo "     sudo certbot --nginx -d yourdomain.com"
echo ""
echo "The app will be reachable at http://$(curl -s ifconfig.me)"

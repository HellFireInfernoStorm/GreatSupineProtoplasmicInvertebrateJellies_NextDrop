#!/bin/bash
# First-boot setup for the public deployment (ADR 0051). Paste into "User data" when creating a DigitalOcean
# droplet (Ubuntu 24.04, 2 GB). It runs once as root, and the stack is up a few minutes after boot.
# Attach a Cloud Firewall that allows only 22, 80 and 443: Docker bypasses ufw and `app` publishes 8080.
# Progress: /var/log/cloud-init-output.log. Redeploy later with /opt/nextdrop/docker/redeploy.sh (ADR 0054).
set -euxo pipefail

# Public hostname. Point its A record at the droplet (or its Reserved IP) first. Empty: use <ip>.sslip.io.
DOMAIN="nextdrop.duckdns.org"

# Swap, so the image build fits in 2 GB of RAM.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

curl -fsSL https://get.docker.com | sh

git clone https://github.com/HellFireInfernoStorm/GreatSupineProtoplasmicInvertebrateJellies_NextDrop.git /opt/nextdrop
cd /opt/nextdrop

# Fallback: sslip.io resolves <ip>.sslip.io to <ip>, so Caddy can get a certificate without a domain.
if [ -z "$DOMAIN" ]; then
  IP=$(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)
  DOMAIN="$IP.sslip.io"
fi

# COMPOSE_PROFILES=public makes every plain `docker compose` command include Caddy.
cat > .env <<EOF
COMPOSE_PROFILES=public
CADDY_DOMAIN=$DOMAIN
PUBLIC_ORIGIN=https://$DOMAIN
SESSION_SECRET=$(openssl rand -hex 32)
DEMO_SCRIPT_KEY=$(openssl rand -hex 24)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
DEMO_MODE=true
TZ=Asia/Colombo
EOF
chmod 600 .env

# Build, start, and reset the demo to before-cutoff so the clock sits on the seeded story day.
docker/redeploy.sh

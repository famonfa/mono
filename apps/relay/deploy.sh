#!/bin/sh
# Deploys the relay to the Oracle Cloud VM it shares with Omno (ssh host `pelado-oracle`).
# First run also creates /srv/mono-relay/.env (with a fresh SESSION_SECRET), the systemd unit and the Caddy site.
# Omno's own service and Caddy site are never touched.
set -eu
HOST=${MONO_RELAY_HOST:-pelado-oracle}
DOMAIN=${MONO_RELAY_DOMAIN:-mono.155-181-39-178.sslip.io}
ADMINS=${ADMIN_EMAILS:-facundo@avocadopos.com}
DIR=/srv/mono-relay
cd "$(dirname "$0")"

ssh "$HOST" "sudo mkdir -p $DIR && sudo chown \$(whoami) $DIR"
rsync -az --delete --exclude node_modules --exclude data --exclude downloads --exclude .env --exclude Dockerfile --exclude deploy.sh ./ "$HOST:$DIR/"

ssh "$HOST" DIR="$DIR" DOMAIN="$DOMAIN" ADMINS="$ADMINS" 'sh -s' <<'REMOTE'
set -eu
cd "$DIR"
npm install --omit=dev --no-audit --no-fund --silent
mkdir -p data

if [ ! -f .env ]; then
  umask 077
  cat > .env <<ENV
PORT=4700
PUBLIC_URL=https://$DOMAIN
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_EMAILS=$ADMINS
DB_PATH=$DIR/data/relay.db
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ENV
fi

if [ ! -f /etc/systemd/system/mono-relay.service ]; then
  sudo tee /etc/systemd/system/mono-relay.service > /dev/null <<UNIT
[Unit]
Description=Mono relay (Google login + tunnel to Macs)
After=network-online.target

[Service]
User=$(whoami)
WorkingDirectory=$DIR
ExecStart=/usr/bin/node --env-file=$DIR/.env --no-warnings src/main.mjs
Restart=always
RestartSec=3
# Shares the VM with Omno: cap it so it can never starve the film club.
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable mono-relay
fi
sudo systemctl restart mono-relay

if ! grep -q "$DOMAIN" /etc/caddy/Caddyfile; then
  BACKUP="/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
  sudo cp /etc/caddy/Caddyfile "$BACKUP"
  printf '\n# Mono relay (apps/relay in famonfa/mono). No `encode`: it would buffer the live event stream.\n%s {\n\treverse_proxy 127.0.0.1:4700\n}\n' "$DOMAIN" | sudo tee -a /etc/caddy/Caddyfile > /dev/null
  sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 || { sudo cp "$BACKUP" /etc/caddy/Caddyfile; echo "Invalid Caddyfile; restored" >&2; exit 1; }
  sudo systemctl reload caddy
fi
sleep 2
systemctl is-active mono-relay
REMOTE
echo "✓ https://$DOMAIN"

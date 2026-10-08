#!/usr/bin/env bash
# One-time setup of a fresh Oracle Cloud Ubuntu VM for the Dev Resolve backend. Run on the VM:
#   curl -fsSL https://raw.githubusercontent.com/bhavyanksarolia-shipsy/dev-resolve/main/deploy/oracle/setup.sh | bash
# Safe to run again. It installs Docker, opens ports 80/443, gets the code, creates the database and its two roles,
# and adds: `dr` (the docker compose command), auto-update from GitHub every 5 min, and a nightly database backup.
set -euo pipefail
REPO="${REPO:-https://github.com/bhavyanksarolia-shipsy/dev-resolve.git}"
DIR=/opt/dev-resolve
ETC=/etc/dev-resolve
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "Installing Docker and tools"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; fi
sudo apt-get install -y -qq git netfilter-persistent iptables-persistent >/dev/null
sudo usermod -aG docker "$USER" || true

say "Opening ports 80 and 443 on this VM's firewall"
# Oracle's Ubuntu images reject everything but SSH in iptables (on top of the cloud Security List).
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$p" -m state --state NEW -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

say "Getting the code into $DIR"
if [ -d "$DIR/.git" ]; then sudo git -C "$DIR" pull -q --ff-only; else sudo git clone -q "$REPO" "$DIR"; fi

say "Settings in $ETC (root only)"
sudo mkdir -p "$ETC" && sudo chmod 700 "$ETC"
IP=$(curl -fsS https://api.ipify.org)
if ! sudo test -f "$ETC/compose.env"; then
  echo "DOMAIN=${IP//./-}.sslip.io" | sudo tee "$ETC/compose.env" >/dev/null
fi
DOMAIN=$(sudo sed -n 's/^DOMAIN=//p' "$ETC/compose.env")
pw() { openssl rand -hex 24; }
if ! sudo test -f "$ETC/db.env"; then
  ADMIN=$(pw) OWNER=$(pw) APP=$(pw)
  sudo tee "$ETC/db.env" >/dev/null <<EOF
POSTGRES_PASSWORD=$ADMIN
DB_OWNER_PASSWORD=$OWNER
DB_APP_PASSWORD=$APP
DATABASE_URL=postgres://dev_resolve_app:$APP@postgres:5432/dev_resolve
MIGRATION_DATABASE_URL=postgres://dev_resolve_owner:$OWNER@postgres:5432/dev_resolve
EOF
fi
sudo test -f "$ETC/app.env" || sudo touch "$ETC/app.env"
sudo chmod 600 "$ETC"/*.env

say "Installing the 'dr' command"
sudo tee /usr/local/bin/dr >/dev/null <<EOF
#!/usr/bin/env bash
# Dev Resolve: docker compose with the right files. e.g.  dr ps · dr logs -f app · dr restart app · dr up -d --build
exec sudo docker compose -f $DIR/deploy/oracle/docker-compose.yml --env-file $ETC/compose.env "\$@"
EOF
sudo chmod 755 /usr/local/bin/dr
sudo chmod 755 "$DIR"/deploy/oracle/*.sh

say "Starting Postgres and creating the database"
dr up -d postgres
until dr exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done
if ! dr exec -T postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='dev_resolve'" | grep -q 1; then
  # shellcheck disable=SC1090
  OWNER=$(sudo sed -n 's/^DB_OWNER_PASSWORD=//p' "$ETC/db.env") APP=$(sudo sed -n 's/^DB_APP_PASSWORD=//p' "$ETC/db.env")
  dr exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -v owner_pw="'$OWNER'" -v app_pw="'$APP'" < "$DIR/apps/api/db/roles.sql" >/dev/null
  echo "created database dev_resolve with roles dev_resolve_owner (migrations) and dev_resolve_app (the app)"
else
  echo "database already there — left as it is"
fi

say "Auto-update from GitHub (every 5 min) and nightly backup (02:30 IST)"
sudo tee /etc/systemd/system/dev-resolve-update.service >/dev/null <<EOF
[Unit]
Description=Dev Resolve: deploy new commits from GitHub
[Service]
Type=oneshot
ExecStart=$DIR/deploy/oracle/update.sh
EOF
sudo tee /etc/systemd/system/dev-resolve-update.timer >/dev/null <<'EOF'
[Unit]
Description=Dev Resolve: check GitHub for new commits every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
sudo tee /etc/systemd/system/dev-resolve-backup.service >/dev/null <<EOF
[Unit]
Description=Dev Resolve: database backup (local + Neon)
[Service]
Type=oneshot
ExecStart=$DIR/deploy/oracle/backup.sh
EOF
sudo tee /etc/systemd/system/dev-resolve-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Dev Resolve: nightly database backup
[Timer]
OnCalendar=*-*-* 21:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now dev-resolve-backup.timer >/dev/null
# Auto-update starts once the app is running (migrate-db.sh turns it on), so it can't start a half-set-up app.

say "Done with the VM part"
cat <<EOF
  Address of this backend:  https://$DOMAIN
  Next (see deploy/oracle/README.md):
    1. On your Mac:  deploy/oracle/send-env.sh $IP      (copies the settings from Railway — nothing shown on screen)
    2. Here:         $DIR/deploy/oracle/migrate-db.sh   (copies the data from Railway, then starts Dev Resolve)
EOF

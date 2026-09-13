#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Installs / updates the Vgantt API on the same server as PostgreSQL.
#
#   sudo ./deploy/install.sh                 # build + install + (re)start
#   sudo ./deploy/install.sh --with-db       # also run the database migrations
#   sudo ./deploy/install.sh --with-web      # also build the React frontend
#
# Idempotent: safe to re-run for every deployment.
# -----------------------------------------------------------------------------
set -euo pipefail

APP_DIR="${VGANTT_APP_DIR:-/opt/vgantt}"
ENV_DIR=/etc/vgantt
ENV_FILE="$ENV_DIR/api.env"
SERVICE=vgantt-api
RUN_USER=vgantt
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WITH_DB=0; WITH_WEB=0
for arg in "$@"; do
  case "$arg" in
    --with-db)  WITH_DB=1 ;;
    --with-web) WITH_WEB=1 ;;
    *) echo "bilinmeyen parametre: $arg" >&2; exit 64 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Bu betik root olarak calistirilmali (sudo)." >&2; exit 1; }

say() { printf '\n\033[1m>> %s\033[0m\n' "$*"; }

# --- 1. prerequisites --------------------------------------------------------
say "Gereksinimler kontrol ediliyor"
command -v node >/dev/null || { echo "Node.js bulunamadi. Node 22 LTS kurun." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || { echo "Node 22+ gerekli, bulunan: $(node -v)" >&2; exit 1; }
command -v psql >/dev/null || echo "   uyari: psql yok, --with-db kullanamazsiniz"
echo "   node $(node -v), npm $(npm -v)"

# --- 2. service account ------------------------------------------------------
if ! id "$RUN_USER" >/dev/null 2>&1; then
  say "Servis kullanicisi olusturuluyor: $RUN_USER"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi

# --- 3. code -----------------------------------------------------------------
say "Kod $APP_DIR dizinine kopyalaniyor"
mkdir -p "$APP_DIR"
# Deployed tree carries sources + build output, never node_modules or .env.
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude '.env' --exclude '.env.local' \
  --exclude 'apps/desktop' --exclude 'dist' \
  "$REPO_DIR"/ "$APP_DIR"/

# --- 4. environment file -----------------------------------------------------
mkdir -p "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  say "Ayar dosyasi olusturuluyor: $ENV_FILE"
  install -m 0640 -o root -g "$RUN_USER" "$REPO_DIR/deploy/api.env.example" "$ENV_FILE"
  echo "   ! $ENV_FILE icindeki __DEGISTIRIN__ alanlarini doldurun:"
  echo "     DB_APP_PASSWORD, DB_PLATFORM_PASSWORD, JWT_SECRET"
  echo "     JWT_SECRET uretmek icin:  openssl rand -base64 48"
  NEEDS_SECRETS=1
else
  chown root:"$RUN_USER" "$ENV_FILE"; chmod 0640 "$ENV_FILE"
  NEEDS_SECRETS=0
fi

if grep -q '__DEGISTIRIN__' "$ENV_FILE" 2>/dev/null; then
  echo "   ! Ayarlar tamamlanmadan servis baslatilmayacak."
  NEEDS_SECRETS=1
fi

# --- 5. build ----------------------------------------------------------------
say "Bagimliliklar kuruluyor ve API derleniyor"
cd "$APP_DIR"
# The Nest build needs its dev dependencies, so install everything, build, then
# drop them. npm ci is preferred when a lockfile exists: it is reproducible and
# will not silently pick up a newer transitive dependency between deployments.
if [[ -f package-lock.json ]]; then
  npm ci --include-workspace-root --workspace @vgantt/api --no-audit --no-fund
else
  echo "   uyari: package-lock.json yok, npm install kullaniliyor."
  echo "          Tekrarlanabilir kurulum icin lockfile'i depoya ekleyin."
  npm install --include-workspace-root --workspace @vgantt/api --no-audit --no-fund
fi
npm run build --workspace @vgantt/api
npm prune --omit=dev

if [[ "$WITH_WEB" == 1 ]]; then
  say "Arayuz derleniyor"
  npm install --include-workspace-root --workspace @vgantt/web --no-audit --no-fund
  npm run build --workspace @vgantt/web
  # Pruning again: the web build's dev dependencies are not needed at runtime.
  npm prune --omit=dev
fi

chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"

# --- 6. database -------------------------------------------------------------
if [[ "$WITH_DB" == 1 ]]; then
  say "Veritabani gocleri uygulaniyor"
  # migrate.sh creates roles and an event trigger, so it needs a superuser
  # connection - not the vgantt_api role the service runs as.
  ( set -a; . "$ENV_FILE"; set +a
    export VGANTT_DB="${DB_NAME:-vgantt}"
    export VGANTT_DB_APP_PASSWORD="$DB_APP_PASSWORD"
    export VGANTT_DB_PLATFORM_PASSWORD="$DB_PLATFORM_PASSWORD"
    sudo -E -u postgres "$APP_DIR/db/migrate.sh" --seed )
  echo "   goc tamam. Demo veri icin: sudo -u postgres $APP_DIR/db/migrate.sh --demo"
fi

# --- 7. service --------------------------------------------------------------
say "systemd servisi kuruluyor"
# systemd needs an absolute ExecStart and does not expand PATH, so the detected
# node binary is substituted in rather than assuming /usr/bin/node.
NODE_BIN="$(command -v node)"
sed "s|^ExecStart=.*|ExecStart=${NODE_BIN} apps/api/dist/main.js|" \
  "$REPO_DIR/deploy/vgantt-api.service" > /etc/systemd/system/"$SERVICE".service
chmod 0644 /etc/systemd/system/"$SERVICE".service
echo "   ExecStart=${NODE_BIN} apps/api/dist/main.js"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

if [[ "$NEEDS_SECRETS" == 1 ]]; then
  say "KURULUM YARIM: once $ENV_FILE doldurun, sonra:"
  echo "   sudo systemctl start $SERVICE"
  exit 0
fi

systemctl restart "$SERVICE"
sleep 3

# --- 8. verify ---------------------------------------------------------------
say "Dogrulama"
if systemctl is-active --quiet "$SERVICE"; then
  echo "   servis calisiyor"
else
  echo "   ! servis baslamadi. Gunluk:"
  journalctl -u "$SERVICE" -n 40 --no-pager
  exit 1
fi

PORT_VALUE="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || echo 3000)"
PREFIX_VALUE="$(grep -E '^API_PREFIX=' "$ENV_FILE" | cut -d= -f2 || echo api)"

if curl -fsS "http://127.0.0.1:${PORT_VALUE}/${PREFIX_VALUE}/health" >/dev/null; then
  echo "   /health yanit veriyor"
else
  echo "   ! /health yanit vermiyor"; journalctl -u "$SERVICE" -n 40 --no-pager; exit 1
fi

# Module C invariant: no credential-shaped column anywhere in the database.
if curl -fsS "http://127.0.0.1:${PORT_VALUE}/${PREFIX_VALUE}/health/vault-policy" | grep -q '"compliant":true'; then
  echo "   sifre kasasi kurali gecerli (veritabaninda kimlik bilgisi kolonu yok)"
else
  echo "   ! sifre kasasi kurali ihlal ediliyor - /health/vault-policy ciktisina bakin"
fi

say "Tamam"
echo "   durum   : systemctl status $SERVICE"
echo "   gunluk  : journalctl -u $SERVICE -f"
echo "   yeniden : sudo $0"

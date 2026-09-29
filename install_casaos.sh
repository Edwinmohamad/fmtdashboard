#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="/DATA/AppData/fmt_dashboard"; APP="$ROOT/app"; BACKUPS="$ROOT/backups"; TMP="$ROOT/.install_tmp"; TS="$(date +%Y%m%d-%H%M%S)"
CONTAINER="fmt-tbs-dashboard"; DEFAULT_PORT=8096; MAX_PORT=8115
log(){ printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail(){ echo; echo "ERROR: $*" >&2; exit 1; }
trap 'rc=$?; if [ $rc -ne 0 ]; then echo; echo "Installer stopped with code $rc" >&2; docker logs --tail 160 "$CONTAINER" 2>/dev/null || true; fi' EXIT
[ "$(id -u)" -eq 0 ] || fail "Run this installer as root."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed or not in PATH."
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); elif command -v docker-compose >/dev/null 2>&1; then COMPOSE=(docker-compose); else fail "Docker Compose is not available."; fi
command -v unzip >/dev/null 2>&1 || { log "Installing unzip..."; apt-get update -y >/dev/null && apt-get install -y unzip >/dev/null; }
command -v curl >/dev/null 2>&1 || { log "Installing curl..."; apt-get update -y >/dev/null && apt-get install -y curl >/dev/null; }
mkdir -p "$ROOT" "$BACKUPS"

ZIP="$ROOT/fmt-tbs-dashboard-final-production-v2.3.zip"
if [ ! -f "$ZIP" ]; then ZIP="$(find "$ROOT" -maxdepth 1 -type f -iname '*fmt*tbs*dashboard*v2.3*.zip' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"; fi
[ -n "$ZIP" ] && [ -f "$ZIP" ] || fail "V2.3 package was not found in $ROOT"
unzip -tq "$ZIP" >/dev/null || fail "ZIP validation failed: $ZIP"
log "Using package: $ZIP"

rm -rf "$TMP"; mkdir -p "$TMP/extract"; unzip -q "$ZIP" -d "$TMP/extract"; SRC="$TMP/extract"
count="$(find "$SRC" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"; if [ "$count" = "1" ]; then one="$(find "$SRC" -mindepth 1 -maxdepth 1 | head -1)"; [ -d "$one" ] && [ -f "$one/docker-compose.yml" ] && SRC="$one"; fi
[ -f "$SRC/docker-compose.yml" ] || fail "docker-compose.yml missing."
[ -f "$SRC/app/main.py" ] || fail "Application source incomplete."
[ "$(tr -d '\r\n ' < "$SRC/VERSION" 2>/dev/null || true)" = "2.3.0" ] || fail "Package VERSION is not 2.3.0."
grep -q 'app.css?v=2.3.0' "$SRC/app/templates/base.html" || fail "V2.3 cache-safe stylesheet reference missing."
grep -q 'login-shell' "$SRC/app/templates/login.html" || fail "Premium V2.3 login UI missing."
grep -q 'grid-template-areas:"queue stage" "queue controls"' "$SRC/app/static/app.css" || fail "V2.3 signing layout missing."
grep -q 'profileMenuBtn' "$SRC/app/static/app.js" || fail "V2.3 account-menu JavaScript missing."
if grep -q "CREATE INDEX IF NOT EXISTS idx_attendance_batch ON attendance(batch_id);" "$SRC/app/db.py" && awk '/SCHEMA = r/{inschema=1} /INDEXES = r/{inschema=0} inschema && /idx_attendance_batch/{found=1} END{exit !found}' "$SRC/app/db.py"; then fail "Package contains the known old batch_id migration-order bug."; fi

# Stop only this application.
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then log "Stopping previous FMT dashboard container..."; docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
NEW="$ROOT/app.new-$TS"; cp -a "$SRC" "$NEW"; mkdir -p "$NEW/data" "$NEW/uploads"
if [ -d "$APP" ]; then
  log "Backing up and preserving existing database/uploads..."
  mkdir -p "$BACKUPS/source-$TS"
  [ -f "$APP/data/fmt_tbs.db" ] && cp -a "$APP/data/fmt_tbs.db" "$BACKUPS/fmt_tbs-$TS.db"
  [ -f "$APP/.env" ] && cp -a "$APP/.env" "$NEW/.env"
  rm -rf "$NEW/data" "$NEW/uploads"
  [ -d "$APP/data" ] && mv "$APP/data" "$NEW/data" || mkdir -p "$NEW/data"
  [ -d "$APP/uploads" ] && mv "$APP/uploads" "$NEW/uploads" || mkdir -p "$NEW/uploads"
  mv "$APP" "$BACKUPS/source-$TS/app-old"
fi
mkdir -p "$NEW/uploads/branding" "$NEW/data"
if [ -f "$ROOT/bdx.logo" ]; then cp -f "$ROOT/bdx.logo" "$NEW/uploads/branding/bdx.logo"; log "Installed BDX logo from $ROOT/bdx.logo"; fi

port_in_use(){ local p="$1"; if command -v ss >/dev/null 2>&1; then ss -lntH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${p}$"; else docker ps --format '{{.Ports}}' | grep -Eq "(^|:)${p}->"; fi; }
PORT="$DEFAULT_PORT"; while [ "$PORT" -le "$MAX_PORT" ] && port_in_use "$PORT"; do PORT=$((PORT+1)); done
[ "$PORT" -le "$MAX_PORT" ] || fail "No free TCP port found between $DEFAULT_PORT and $MAX_PORT."
ENVFILE="$NEW/.env"; touch "$ENVFILE"
set_env(){ local k="$1" v="$2"; if grep -qE "^${k}=" "$ENVFILE"; then sed -i "s#^${k}=.*#${k}=${v}#" "$ENVFILE"; else echo "${k}=${v}" >> "$ENVFILE"; fi; }
set_env FMT_PORT "$PORT"; set_env FMT_ADMIN_USER admin; set_env FMT_ADMIN_PASSWORD admin; set_env FMT_SESSION_HOURS 12; set_env FMT_MAX_UPLOAD_MB 50; set_env FMT_COOKIE_SECURE 0; chmod 600 "$ENVFILE"
mv "$NEW" "$APP"; cd "$APP"

log "Building V2.3 production image..."; "${COMPOSE[@]}" build
log "Starting FMT Operations Dashboard on host port $PORT..."; "${COMPOSE[@]}" up -d
log "Waiting for application health check..."; healthy=0
for i in $(seq 1 60); do status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || true)"; [ "$status" = healthy ] && { healthy=1; break; }; [ "$status" = exited ] || [ "$status" = dead ] && break; sleep 2; done
[ "$healthy" -eq 1 ] || fail "FMT dashboard did not become healthy. Previous source backup is under $BACKUPS/source-$TS when upgrading."

# Enforce requested bootstrap credentials and clear prior admin sessions.
docker exec "$CONTAINER" python - <<'PYRESET'
from app.db import q, execute, now
from app.auth import hash_password
u=q("SELECT id FROM users WHERE username='admin'",one=True)
if u:
    execute("UPDATE users SET password_hash=?,active=1 WHERE id=?",(hash_password('admin'),u['id'])); execute("DELETE FROM sessions WHERE user_id=?",(u['id'],))
else:
    execute("INSERT INTO users(username,full_name,password_hash,role,active,division,site,created_at) VALUES('admin','Administrator',?,'Administrator',1,'FMT','TBS',?)",(hash_password('admin'),now()))
PYRESET

log "Running production validation..."
curl -fsS "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"' || fail "/health validation failed."
docker exec "$CONTAINER" python -m py_compile /app/app/main.py /app/app/db.py /app/app/auth.py /app/app/services.py || fail "Python compilation failed in container."
docker exec "$CONTAINER" python - <<'PYTPL'
from jinja2 import Environment, FileSystemLoader
from pathlib import Path
p=Path('/app/app/templates'); e=Environment(loader=FileSystemLoader(p))
for f in p.glob('*.html'): e.get_template(f.name)
print('templates-ok')
PYTPL

COOKIE="/tmp/fmt-cookie-$TS"; code="$(curl -sS -o /dev/null -c "$COOKIE" -w '%{http_code}' -X POST -d 'username=admin&password=admin' "http://127.0.0.1:${PORT}/login")"; [ "$code" = 303 ] || fail "Admin login smoke test failed (HTTP $code)."
for route in / /attendance /attendance/upload /attendance/signing /signatures /inventory/assets /inventory/tools /consumables /tickets /reports /activity /users /roles /settings /profile; do code="$(curl -sS -o /dev/null -b "$COOKIE" -w '%{http_code}' "http://127.0.0.1:${PORT}${route}")"; [ "$code" = 200 ] || fail "Route smoke test failed: $route returned HTTP $code"; done
rm -f "$COOKIE"
css="$(curl -fsS "http://127.0.0.1:${PORT}/static/app.css?v=2.3.0")"; grep -q 'dashboard-hero' <<<"$css" || fail "V2.3 CSS was not served correctly."
js="$(curl -fsS "http://127.0.0.1:${PORT}/static/app.js?v=2.3.0")"; grep -q 'profileMenuBtn' <<<"$js" || fail "V2.3 JavaScript was not served correctly."

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; IP="${IP:-192.168.100.110}"
cat > "$ROOT/INSTALL_INFO.txt" <<INFO
FMT Operations Dashboard — Site TBS
Version: 2.3.0
Installed: $(date)
URL: http://${IP}:${PORT}
Port: ${PORT}
Username: admin
Password: admin
App directory: ${APP}
Database: ${APP}/data/fmt_tbs.db
Uploads: ${APP}/uploads
INFO
chmod 600 "$ROOT/INSTALL_INFO.txt"; rm -rf "$TMP"
trap - EXIT
echo; echo "============================================================"; echo " FMT OPERATIONS DASHBOARD V2.3 — INSTALLATION SUCCESS"; echo "============================================================"; echo " UI Build       : PREMIUM V2.3.0"; echo " Division       : FMT"; echo " Site           : TBS"; echo " Container      : $CONTAINER"; echo " Status         : HEALTHY + ROUTE TESTS PASSED"; echo " URL            : http://${IP}:${PORT}"; echo " Username       : admin"; echo " Password       : admin"; echo " Port Mapping   : ${PORT} -> 8096"; echo " Beszel 8090    : NOT TOUCHED"; echo "============================================================"; echo "Security: change admin password before exposing the service publicly."

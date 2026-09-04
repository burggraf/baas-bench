#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BAAS="$ROOT/bin/baas"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expected='supabase
neon
convex
appwrite
nhost
directus
pocketbase
trailbase'
actual=$($BAAS list) || fail "list command failed"
[ "$actual" = "$expected" ] || fail "unexpected service list"
grep -q '^NHOST_TRAEFIK_IMAGE=traefik:v3\.6\.1@sha256:' "$ROOT/versions.env" || fail "Nhost Traefik compatibility image is not pinned"
grep -q 'ADMIN_EMAIL: admin@example.com' "$ROOT/services/directus/compose.yml" || fail "Directus bootstrap email is invalid"

if "$BAAS" setup unknown >/dev/null 2>&1; then
  fail "unknown service was accepted"
fi

mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'EOF'
#!/bin/sh
echo "docker $*" >> "$BAAS_TEST_LOG"
case "$*" in *' exec '*) printf '%s\n' 1;; esac
exit 0
EOF
cat > "$TMP/bin/curl" <<'EOF'
#!/bin/sh
echo "curl $*" >> "$BAAS_TEST_LOG"
case "$*" in *"${BAAS_TEST_FAIL_URL:-never-match}"*) exit 22;; esac
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done
if [ -n "$output" ]; then
  case "$url" in
    */docker-compose.yml) printf '%s\n' 'services: {}' > "$output" ;;
    */.env) cat > "$output" <<'ENV'
_APP_OPENSSL_KEY_V1=your-secret-key
_APP_EXECUTOR_SECRET=your-secret-key
_APP_DB_PASS=password
_APP_DB_ROOT_PASS=rootsecretpassword
ENV
      ;;
    */mongo-entrypoint.sh) printf '%s\n' '#!/bin/sh' > "$output" ;;
    */mongo-init.js) printf '%s\n' '// init' > "$output" ;;
    *) exit 22 ;;
  esac
  exit 0
fi
printf '%s\n' '{"status":"ok"}'
EOF
chmod +x "$TMP/bin/docker" "$TMP/bin/curl"

export PATH="$TMP/bin:$PATH"
export BAAS_RUNTIME_DIR="$TMP/runtime"
export BAAS_TEST_LOG="$TMP/calls"
"$BAAS" start directus >/dev/null

stop_line=$(grep -n ' stop' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
up_line=$(grep -n ' up -d' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
[ -n "$stop_line" ] && [ -n "$up_line" ] && [ "$stop_line" -lt "$up_line" ] || fail "start did not stop stacks first"
grep -q "docker compose .*--env-file $BAAS_RUNTIME_DIR/directus/.env .*services/directus/compose.yml" "$BAAS_TEST_LOG" || fail "Directus runtime environment missing"
grep -q 'curl .*localhost:8055/server/ping' "$BAAS_TEST_LOG" || fail "Directus smoke call missing"
[ "$(ls -l "$BAAS_RUNTIME_DIR/directus/.env" | cut -c5-10)" = '------' ] || fail "Directus secrets are not private"

"$BAAS" setup appwrite >/dev/null
[ -f "$BAAS_RUNTIME_DIR/appwrite/mongo-entrypoint.sh" ] || fail "Appwrite Mongo entrypoint was not downloaded"
[ -f "$BAAS_RUNTIME_DIR/appwrite/mongo-init.js" ] || fail "Appwrite Mongo init script was not downloaded"
: > "$BAAS_TEST_LOG"
"$BAAS" start appwrite >/dev/null
grep -q 'docker compose .* restart traefik' "$BAAS_TEST_LOG" || fail "Appwrite proxy was not refreshed after start"

"$BAAS" setup convex >/dev/null
: > "$BAAS_TEST_LOG"
"$BAAS" start convex >/dev/null
grep -q 'docker compose .* up -d --build backend' "$BAAS_TEST_LOG" || fail "Convex backend was not started independently"
backend_line=$(grep -n ' up -d --build backend' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
ready_line=$(grep -n 'curl .*localhost:3210/version' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
dashboard_line=$(grep -n ' up -d --build --no-deps dashboard$' "$BAAS_TEST_LOG" | tail -1 | cut -d: -f1)
[ "$backend_line" -lt "$ready_line" ] && [ "$ready_line" -lt "$dashboard_line" ] || fail "Convex dashboard started before the backend was ready"

mkdir -p "$BAAS_RUNTIME_DIR/supabase/docker"
printf '%s\n' 'services: {}' > "$BAAS_RUNTIME_DIR/supabase/docker/docker-compose.yml"
printf '%s\n' 'SUPABASE_PUBLISHABLE_KEY=test-key' > "$BAAS_RUNTIME_DIR/supabase/docker/.env"
: > "$BAAS_TEST_LOG"
"$BAAS" smoke supabase >/dev/null
grep -q 'curl .* -H apikey: test-key .*localhost:8000/auth/v1/health' "$BAAS_TEST_LOG" || fail "Supabase smoke call missing API key"

: > "$BAAS_TEST_LOG"
"$BAAS" compose supabase exec -T db psql -Atqc 'select 1' >/dev/null
if "$BAAS" compose unknown ps >/dev/null 2>&1; then fail "compose accepted an unknown service"; fi
grep -q 'docker compose .* exec -T db psql -Atqc select 1' "$BAAS_TEST_LOG" || fail "compose passthrough call missing"

: > "$BAAS_TEST_LOG"
export BAAS_TEST_FAIL_URL=localhost:3210
if "$BAAS" smoke all >/dev/null 2>&1; then
  fail "smoke all hid a failed service"
fi
grep -q 'curl .*localhost:4000/api/healthcheck' "$BAAS_TEST_LOG" || fail "smoke all stopped before checking every service"

printf '%s\n' "PASS"

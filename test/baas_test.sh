#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BAAS="$ROOT/bin/baas"
# shellcheck disable=SC1091
. "$ROOT/versions.env"
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
grep -q '^NEON_BUILD_TOOLS_TAG=pinned@sha256:' "$ROOT/versions.env" || fail "Neon proxy build tools image is not pinned"
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
cat > "$TMP/bin/openssl" <<'EOF'
#!/bin/sh
echo "openssl $*" >> "$BAAS_TEST_LOG"
case "$1" in
  rand) printf '%064d\n' 0 ;;
  req)
    output=
    keyout=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -out) output=$2; shift 2 ;;
        -keyout) keyout=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    printf '%s\n' 'test certificate' > "$output"
    printf '%s\n' 'test private key' > "$keyout"
    ;;
esac
EOF
chmod +x "$TMP/bin/docker" "$TMP/bin/curl" "$TMP/bin/openssl"

export PATH="$TMP/bin:$PATH"
export BAAS_RUNTIME_DIR="$TMP/runtime"
export BAAS_TEST_LOG="$TMP/calls"
"$BAAS" start directus >/dev/null

stop_line=$(grep -n ' stop' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
up_line=$(grep -n ' up -d' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
[ -n "$stop_line" ] && [ -n "$up_line" ] && [ "$stop_line" -lt "$up_line" ] || fail "start did not stop stacks first"
grep -q "docker compose .*--env-file $BAAS_RUNTIME_DIR/directus/.env .*services/directus/compose.yml" "$BAAS_TEST_LOG" || fail "Directus runtime environment missing"
if grep 'docker compose .*services/directus/compose.yml' "$BAAS_TEST_LOG" | grep -q 'services/neon/proxy.yml'; then fail "Neon overlay leaked into Directus Compose"; fi
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

mkdir -p "$BAAS_RUNTIME_DIR/neon/docker-compose"
printf '%s\n' "$NEON_REF" > "$BAAS_RUNTIME_DIR/neon/.baas-ref"
printf '%s\n' 'ENV CARGO_FEATURES="default"' > "$BAAS_RUNTIME_DIR/neon/Dockerfile"
printf '%s\n' 'services: {}' > "$BAAS_RUNTIME_DIR/neon/docker-compose/docker-compose.yml"
: > "$BAAS_TEST_LOG"
"$BAAS" setup neon >/dev/null
"$BAAS" setup neon >/dev/null
neon_compose="$BAAS_RUNTIME_DIR/neon/docker-compose/docker-compose.yml"
grep -q '^ENV CARGO_FEATURES="default,testing"$' "$BAAS_RUNTIME_DIR/neon/Dockerfile" || fail "Neon proxy build does not enable its PostgreSQL auth backend"
grep -q "docker compose .* -f $neon_compose -f $ROOT/services/neon/proxy.yml config --quiet" "$BAAS_TEST_LOG" || fail "Neon proxy overlay missing from Compose command"
[ "$(grep -c '^openssl req ' "$BAAS_TEST_LOG")" -eq 1 ] || fail "Neon TLS certificate was not generated exactly once"
grep -q '^openssl req .*subjectAltName=DNS:localhost' "$BAAS_TEST_LOG" || fail "Neon TLS certificate is missing localhost SAN"
[ "$(ls -ld "$BAAS_RUNTIME_DIR/neon/proxy-certs" | cut -c2-10)" = 'rwx------' ] || fail "Neon TLS directory is not private"
for file in localhost.crt localhost.key; do
  [ "$(ls -l "$BAAS_RUNTIME_DIR/neon/proxy-certs/$file" | cut -c5-10)" = '------' ] || fail "Neon TLS file is not private: $file"
done
: > "$BAAS_TEST_LOG"
"$BAAS" smoke neon >/dev/null
grep -q "curl .*--cacert $BAAS_RUNTIME_DIR/neon/proxy-certs/localhost.crt .*https://localhost:4444/sql" "$BAAS_TEST_LOG" || fail "Neon SQL-over-HTTP smoke call missing TLS CA or endpoint"
grep -q 'curl .* -X POST ' "$BAAS_TEST_LOG" || fail "Neon SQL-over-HTTP smoke is not a POST"
grep -q 'curl .*Neon-Connection-String: postgresql://cloud_admin:cloud_admin@localhost:4444/postgres' "$BAAS_TEST_LOG" || fail "Neon SQL-over-HTTP connection header missing"
grep -q 'curl .*--data .*SELECT 1' "$BAAS_TEST_LOG" || fail "Neon SQL-over-HTTP smoke query is invalid"

grep -q '^  proxy:$' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy service missing"
grep -q 'context: \.\.' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy is not built from the pinned official source"
grep -q 'dockerfile: Dockerfile' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy does not use the official Dockerfile"
grep -q 'TAG: ${NEON_BUILD_TOOLS_TAG}' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy build does not use pinned official build tools"
grep -q 'GIT_VERSION: ${NEON_REF}' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy build does not identify the pinned source"
grep -q -- '--auth-backend=postgres' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy PostgreSQL auth backend missing"
grep -q -- '--auth-endpoint=postgresql://cloud_admin:cloud_admin@compute1:55433/postgres' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy compute endpoint missing"
grep -q '127.0.0.1:4444:4444' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy port is not localhost-only"
grep -q 'compute_is_ready' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy readiness dependency missing"
grep -q 'localhost.crt:/etc/neon/localhost.crt:ro' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy certificate mount missing"
grep -q 'localhost.key:/etc/neon/localhost.key:ro' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy key mount missing"

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

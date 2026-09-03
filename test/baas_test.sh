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
grep -q 'curl .*localhost:8055/server/health' "$BAAS_TEST_LOG" || fail "Directus smoke call missing"
[ "$(ls -l "$BAAS_RUNTIME_DIR/directus/.env" | cut -c5-10)" = '------' ] || fail "Directus secrets are not private"

: > "$BAAS_TEST_LOG"
export BAAS_TEST_FAIL_URL=localhost:3210
if "$BAAS" smoke all >/dev/null 2>&1; then
  fail "smoke all hid a failed service"
fi
grep -q 'curl .*localhost:4000/api/healthcheck' "$BAAS_TEST_LOG" || fail "smoke all stopped before checking every service"

printf '%s\n' "PASS"

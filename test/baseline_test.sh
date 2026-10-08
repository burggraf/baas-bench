#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE=/Users/markb/dev/baas-bench/.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir "$TMP/bin"
printf '#!/bin/sh\necho called > "$BASELINE_TEST_MARKER"\nexit 99\n' > "$TMP/bin/docker"
chmod +x "$TMP/bin/docker"
if BASELINE_TEST_MARKER="$TMP/docker-called" PATH="$TMP/bin:$PATH" "$ROOT/baseline/baseline.sh" run neon > "$TMP/usage.log" 2>&1; then
  echo 'FAIL: unsupported platform accepted' >&2
  exit 1
fi
[ ! -f "$TMP/docker-called" ] || { echo 'FAIL: invalid CLI touched Docker' >&2; exit 1; }
"$NODE" --test "$ROOT/test/baseline_migration_test.mjs" "$ROOT/test/baseline_auth_test.mjs"
"$NODE" "$ROOT/test/baseline_test.mjs"
"$NODE" --test "$ROOT/test/baseline_supabase_test.mjs"
"$NODE" "$ROOT/test/baseline_volume_test.mjs"
"$NODE" "$ROOT/test/baseline_network_test.mjs"
"$NODE" "$ROOT/test/baseline_capacity_test.mjs"
"$NODE" --test "$ROOT/test/baseline_cap_expansion_test.mjs"
"$NODE" --test "$ROOT/test/baseline_supabase_capacity_test.mjs"
if BASELINE_TEST_MARKER="$TMP/capacity-docker-called" PATH="$TMP/bin:$PATH" "$ROOT/baseline/capacity.sh" supabase --max-vus 660 > "$TMP/capacity-usage.log" 2>&1; then
  echo 'FAIL: capacity command exceeded approved Supabase ceiling' >&2
  exit 1
fi
[ ! -f "$TMP/capacity-docker-called" ] || { echo 'FAIL: invalid capacity command touched Docker' >&2; exit 1; }

#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BENCH="$ROOT/bin/bench"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

export BENCH_SETS_DIR="$TMP/benchmark-sets"
export BENCH_LOCAL_RESULTS_DIR="$TMP/.results"
export BENCH_RESULTS_DIR="$TMP/results"

"$BENCH" new set core-v1
"$BENCH" new benchmark core-v1 read-throughput
"$BENCH" new case core-v1 read-throughput supabase rest-api

SET="$BENCH_SETS_DIR/core-v1"
BENCHMARK="$SET/benchmarks/read-throughput"
CASE="$BENCHMARK/cases/supabase/rest-api"

[ -f "$SET/set.conf" ] || fail "set scaffold missing"
[ -f "$BENCHMARK/METHODOLOGY.md" ] || fail "methodology scaffold missing"
[ -f "$CASE/case.conf" ] || fail "case scaffold missing"
for hook in setup verify reset run teardown; do
  [ -x "$CASE/$hook.sh" ] || fail "$hook hook is not executable"
done
grep -q '^id=core-v1$' "$SET/set.conf" || fail "set id was not substituted"
grep -q '^id=read-throughput$' "$BENCHMARK/benchmark.conf" || fail "benchmark id was not substituted"
grep -q '^platform=supabase$' "$CASE/case.conf" || fail "platform was not substituted"
grep -q '^variant=rest-api$' "$CASE/case.conf" || fail "variant was not substituted"

if "$BENCH" new set core-v1 >/dev/null 2>&1; then
  fail "existing set was overwritten"
fi
if "$BENCH" new case core-v1 read-throughput unknown rest-api >/dev/null 2>&1; then
  fail "unknown platform was accepted"
fi

printf '%s\n' PASS

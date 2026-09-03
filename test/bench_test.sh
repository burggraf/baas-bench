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

if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then
  fail "unfinished template passed validation"
fi
for file in "$SET/set.conf" "$BENCHMARK/benchmark.conf" "$CASE/case.conf" "$BENCHMARK/METHODOLOGY.md" "$CASE/README.md" "$CASE"/*.sh; do
  sed -i.bench_test -e 's/^title=TODO/title=Core benchmarks/' -e 's/^description=TODO/description=Description/' -e 's/^primary_metric=TODO/primary_metric=operations_per_second/' -e 's/^primary_unit=TODO/primary_unit=ops\/s/' -e 's/^primary_direction=TODO/primary_direction=higher/' -e 's/^required_metrics=TODO/required_metrics=operations_per_second/' -e 's/^warmup_trials=TODO/warmup_trials=0/' -e 's/^measured_trials=TODO/measured_trials=1/' -e 's/=TODO/=documented/g' -e 's/^TODO$/documented/' -e 's/TODO: implement.*/implemented/' "$file"
  rm -f "$file.bench_test"
done
for hook in setup verify reset run teardown; do printf '#!/bin/sh\nset -eu\n:\n' > "$CASE/$hook.sh"; chmod +x "$CASE/$hook.sh"; done
"$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null || fail "valid case failed validation"
"$BENCH" validate all >/dev/null || fail "valid tree failed validation"
printf 'password=do-not-store-this\n' >> "$CASE/case.conf"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "sensitive key accepted"; fi
sed -i.bench_test '/^password=/d' "$CASE/case.conf"
rm -f "$CASE/case.conf.bench_test"
printf 'platform=duplicate\n' >> "$CASE/case.conf"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "duplicate key accepted"; fi
sed -i.bench_test '/^platform=duplicate/d' "$CASE/case.conf"; rm -f "$CASE/case.conf.bench_test"

FAKE_BAAS="$TMP/baas"
cat > "$FAKE_BAAS" <<'EOF'
#!/bin/sh
case "$1" in list) printf '%s\n' supabase neon convex appwrite nhost directus pocketbase trailbase;; start|stop) printf '%s %s\n' "$1" "$2" >> "$BENCH_TEST_LOG";; esac
EOF
chmod +x "$FAKE_BAAS"
export BENCH_BAAS_BIN="$FAKE_BAAS" BENCH_ALLOW_DIRTY=1 BENCH_TEST_LOG="$TMP/log"
cat > "$CASE/setup.sh" <<'EOF'
#!/bin/sh
set -eu
echo setup >> "$BENCH_TEST_LOG"
EOF
cat > "$CASE/verify.sh" <<'EOF'
#!/bin/sh
set -eu
echo verify >> "$BENCH_TEST_LOG"
EOF
cat > "$CASE/reset.sh" <<'EOF'
#!/bin/sh
set -eu
echo "reset:$BENCH_PHASE:$BENCH_TRIAL" >> "$BENCH_TEST_LOG"
EOF
cat > "$CASE/run.sh" <<'EOF'
#!/bin/sh
set -eu
echo "run:$BENCH_PHASE:$BENCH_TRIAL" >> "$BENCH_TEST_LOG"
[ "$BENCH_PHASE" = measure ] && printf '{"schema_version":1,"duration_seconds":1,"completed_operations":1,"failed_operations":0,"error_rate":0,"metrics":{"operations_per_second":1}}\n' > "$BENCH_OUTPUT_DIR/summary.json"
EOF
cat > "$CASE/teardown.sh" <<'EOF'
#!/bin/sh
set -eu
echo teardown >> "$BENCH_TEST_LOG"
EOF
chmod +x "$CASE"/*.sh
run_dir=$($BENCH run core-v1 read-throughput supabase rest-api)
[ -f "$run_dir/run.json" ] || fail "run manifest missing"
jq -e '.status == "complete" and .debug == false' "$run_dir/run.json" >/dev/null || fail "run not complete"
[ -f "$run_dir/trials/001/summary.json" ] || fail "trial summary missing"
grep -q '^start supabase$' "$TMP/log" || fail "platform did not start"
grep -q '^stop supabase$' "$TMP/log" || fail "platform did not stop"
published=$($BENCH publish "$run_dir")
expected="$BENCH_RESULTS_DIR/core-v1/read-throughput/supabase/rest-api/$(basename "$run_dir")"
[ "$published" = "$expected" ] || fail "unexpected publish destination"
[ -f "$expected/run.json" ] || fail "published run manifest missing"
[ -f "$expected/trials/001/summary.json" ] || fail "published summary missing"
[ ! -d "$expected/trials/001/raw" ] || fail "raw output was committed"
if "$BENCH" publish "$TMP" >/dev/null 2>&1; then fail "outside bundle was published"; fi
grep -qx '.results/' "$ROOT/.gitignore" || fail "local benchmark results are not ignored"
[ -d "$ROOT/results" ] || fail "published results directory missing"

printf '%s\n' PASS

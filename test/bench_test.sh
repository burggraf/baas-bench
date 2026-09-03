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

test_sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi
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
mkdir -p "$SET/shared"
printf '%s\n' 'captured shared workload' > "$SET/shared/runner.txt"

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
for file in "$SET/set.conf" "$SET/README.md" "$BENCHMARK/benchmark.conf" "$CASE/case.conf" "$BENCHMARK/METHODOLOGY.md" "$CASE/README.md" "$CASE"/*.sh; do
  sed -i.bench_test -e 's/^title=TODO/title=Core benchmarks/' -e 's/^description=TODO/description=Description/' -e 's/^primary_metric=TODO/primary_metric=operations_per_second/' -e 's/^primary_unit=TODO/primary_unit=ops\/s/' -e 's/^primary_direction=TODO/primary_direction=higher/' -e 's/^required_metrics=TODO/required_metrics=operations_per_second/' -e 's/^warmup_trials=TODO/warmup_trials=1/' -e 's/^measured_trials=TODO/measured_trials=2/' -e 's/=TODO/=documented/g' -e 's/^TODO$/documented/' -e 's/TODO:.*/documented/' "$file"
  rm -f "$file.bench_test"
done
for hook in setup verify reset run teardown; do printf '#!/bin/sh\nset -eu\n:\n' > "$CASE/$hook.sh"; chmod +x "$CASE/$hook.sh"; done
"$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null || fail "valid case failed validation"
"$BENCH" validate all >/dev/null || fail "valid tree failed validation"
mv "$BENCHMARK/METHODOLOGY.md" "$BENCHMARK/METHODOLOGY.md.missing"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "missing methodology was accepted"; fi
mv "$BENCHMARK/METHODOLOGY.md.missing" "$BENCHMARK/METHODOLOGY.md"
mv "$CASE/README.md" "$CASE/README.md.missing"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "missing case documentation was accepted"; fi
mv "$CASE/README.md.missing" "$CASE/README.md"
printf 'password=do-not-store-this\n' >> "$CASE/case.conf"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "sensitive key accepted"; fi
sed -i.bench_test '/^password=/d' "$CASE/case.conf"
rm -f "$CASE/case.conf.bench_test"
printf 'platform=duplicate\n' >> "$CASE/case.conf"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "duplicate key accepted"; fi
sed -i.bench_test '/^platform=duplicate/d' "$CASE/case.conf"; rm -f "$CASE/case.conf.bench_test"
cp "$BENCHMARK/benchmark.conf" "$TMP/benchmark.conf.valid"
sed -i.bench_test 's/^schema_version=1/schema_version=2/' "$BENCHMARK/benchmark.conf"; rm -f "$BENCHMARK/benchmark.conf.bench_test"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "unknown schema version accepted"; fi
cp "$TMP/benchmark.conf.valid" "$BENCHMARK/benchmark.conf"
sed -i.bench_test 's/^measured_trials=2/measured_trials=0/' "$BENCHMARK/benchmark.conf"; rm -f "$BENCHMARK/benchmark.conf.bench_test"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "zero measured trials accepted"; fi
cp "$TMP/benchmark.conf.valid" "$BENCHMARK/benchmark.conf"
sed -i.bench_test 's/^primary_direction=higher/primary_direction=sideways/' "$BENCHMARK/benchmark.conf"; rm -f "$BENCHMARK/benchmark.conf.bench_test"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "invalid metric direction accepted"; fi
cp "$TMP/benchmark.conf.valid" "$BENCHMARK/benchmark.conf"
chmod -x "$CASE/reset.sh"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "non-executable hook accepted"; fi
chmod +x "$CASE/reset.sh"
printf '%s\n' "'" >> "$CASE/reset.sh"
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then fail "hook syntax error accepted"; fi
sed -i.bench_test '$d' "$CASE/reset.sh"; rm -f "$CASE/reset.sh.bench_test"

FAKE_BAAS="$TMP/baas"
cat > "$FAKE_BAAS" <<'EOF'
#!/bin/sh
case "$1" in
  list) printf '%s\n' supabase neon convex appwrite nhost directus pocketbase trailbase ;;
  start|stop)
    printf '%s %s\n' "$1" "$2" >> "$BENCH_TEST_LOG"
    [ "$1" != start ] || [ "${BENCH_TEST_FAIL_START:-0}" != 1 ] || exit 1
    [ "$1" != stop ] || [ "${BENCH_TEST_FAIL_STOP:-0}" != 1 ] || exit 1
    ;;
esac
EOF
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'EOF'
#!/bin/sh
case "$*" in
  'version --format {{.Server.Version}}') printf '%s\n' 29.4.0 ;;
  'compose version --short') printf '%s\n' 5.1.2 ;;
  'info --format {{.NCPU}}') printf '%s\n' 8 ;;
  'info --format {{.MemTotal}}') printf '%s\n' 17179869184 ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$FAKE_BAAS" "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export BENCH_BAAS_BIN="$FAKE_BAAS" BENCH_TEST_LOG="$TMP/log"
# Dirty definitions require explicit opt-in.
if BENCH_ALLOW_DIRTY=0 "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then fail "dirty definitions accepted"; fi
export BENCH_ALLOW_DIRTY=1
cat > "$CASE/setup.sh" <<'EOF'
#!/bin/sh
set -eu
echo "setup:$BENCH_PHASE:$BENCH_TRIAL:${BENCH_OUTPUT_DIR##*/}" >> "$BENCH_TEST_LOG"
[ "${BENCH_TEST_FAIL_SETUP:-0}" != 1 ]
EOF
cat > "$CASE/verify.sh" <<'EOF'
#!/bin/sh
set -eu
echo "verify:$BENCH_PHASE:$BENCH_TRIAL:${BENCH_OUTPUT_DIR##*/}" >> "$BENCH_TEST_LOG"
[ "${BENCH_TEST_FAIL_VERIFY_PHASE:-}" != "$BENCH_PHASE" ]
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
if [ "${BENCH_TEST_SIGNAL_RUN:-0}" = 1 ]; then kill -TERM "$PPID"; fi
if [ "$BENCH_PHASE" = measure ]; then
  if [ "${BENCH_TEST_OMIT_METRIC:-0}" = 1 ]; then metrics='{}'; else metrics='{"operations_per_second":1}'; fi
  printf '{"schema_version":1,"duration_seconds":1,"completed_operations":1,"failed_operations":0,"error_rate":0,"metrics":%s}\n' "$metrics" > "$BENCH_OUTPUT_DIR/summary.json"
fi
EOF
cat > "$CASE/teardown.sh" <<'EOF'
#!/bin/sh
set -eu
echo "teardown:$BENCH_PHASE:$BENCH_TRIAL:${BENCH_OUTPUT_DIR##*/}" >> "$BENCH_TEST_LOG"
[ "${BENCH_TEST_FAIL_TEARDOWN:-0}" != 1 ]
EOF
chmod +x "$CASE"/*.sh
git -C "$TMP" init -q
git -C "$TMP" config user.name Bench-Test
git -C "$TMP" config user.email bench-test@example.com
git -C "$TMP" add benchmark-sets
git -C "$TMP" commit -qm 'test fixture'
export BENCH_ALLOW_DIRTY=0
run_dir=$($BENCH run core-v1 read-throughput supabase rest-api)
[ -f "$run_dir/run.json" ] || fail "run manifest missing"
jq -e '.status == "complete" and .debug == false' "$run_dir/run.json" >/dev/null || fail "run not complete"
jq -e '.started_at and .finished_at and (.arguments | type == "array") and .definitions_sha256 and (.lifecycle | type == "object")' "$run_dir/run.json" >/dev/null || fail "run manifest lacks provenance or lifecycle outcomes"
jq -e '.docker_server_version == "29.4.0" and .docker_compose_version == "5.1.2" and .docker_cpus == 8 and .docker_memory_bytes == 17179869184' "$run_dir/environment.json" >/dev/null || fail "environment manifest lacks Docker resource provenance"
[ -f "$run_dir/trials/001/summary.json" ] || fail "first trial summary missing"
[ -f "$run_dir/trials/002/summary.json" ] || fail "second trial summary missing"
[ -f "$run_dir/definitions/benchmark-sets/core-v1/shared/runner.txt" ] || fail "set-level shared definitions were not captured"
[ -d "$run_dir/warmups/001/raw" ] || fail "warm-up output directory missing"
grep -q '^start supabase$' "$TMP/log" || fail "platform did not start"
grep -q '^setup:setup:0:' "$TMP/log" || fail "setup did not receive hook context"
grep -q '^verify:verify:0:' "$TMP/log" || fail "initial verify did not receive hook context"
grep -q '^teardown:teardown:0:' "$TMP/log" || fail "teardown did not receive hook context"
grep -q '^stop supabase$' "$TMP/log" || fail "platform did not stop"
expected_lifecycle='start supabase
setup:setup:0
verify:verify:0
reset:warmup:1
run:warmup:1
verify:warmup:1
reset:measure:1
run:measure:1
verify:measure:1
reset:measure:2
run:measure:2
verify:measure:2
teardown:teardown:0
stop supabase'
actual_lifecycle=$(cut -d: -f1-3 "$TMP/log")
[ "$actual_lifecycle" = "$expected_lifecycle" ] || fail "unexpected lifecycle order"

# Every path component is validated before any case path is resolved.
if "$BENCH" validate 'core-v1/read-throughput/supabase/../rest-api' >/dev/null 2>&1; then
  fail "traversal validation target was accepted"
fi
if "$BENCH" run core-v1 read-throughput supabase '../rest-api' --allow-dirty >/dev/null 2>&1; then
  fail "traversal run target was accepted"
fi

# A partially failed platform start is still stopped and recorded.
: > "$TMP/log"
start_failure="$TMP/start-failure"
if BENCH_LOCAL_RESULTS_DIR="$start_failure" BENCH_TEST_FAIL_START=1 "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "failed platform start reported success"
fi
grep -q '^stop supabase$' "$TMP/log" || fail "partial platform start was not stopped"
start_bundle=$(find "$start_failure" -mindepth 1 -maxdepth 1 -type d ! -name '.lock' ! -name '.tmp-*' | head -1)
jq -e '.status == "failed" and .lifecycle.start == "failed" and .lifecycle.stop == "complete"' "$start_bundle/run.json" >/dev/null || fail "failed start lifecycle was not recorded"

# A partially failed setup is torn down and the platform is stopped.
: > "$TMP/log"
setup_failure="$TMP/setup-failure"
if BENCH_LOCAL_RESULTS_DIR="$setup_failure" BENCH_TEST_FAIL_SETUP=1 "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "failed setup reported success"
fi
grep -q '^teardown:teardown:0:' "$TMP/log" || fail "partial setup was not torn down"
grep -q '^stop supabase$' "$TMP/log" || fail "platform was not stopped after setup failure"

# Correctness and summary-contract failures are invalid, not ordinary failures.
invalid_results="$TMP/invalid-results"
if BENCH_LOCAL_RESULTS_DIR="$invalid_results" BENCH_TEST_OMIT_METRIC=1 "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "summary missing a declared metric was accepted"
fi
invalid_bundle=$(find "$invalid_results" -mindepth 1 -maxdepth 1 -type d ! -name '.lock' ! -name '.tmp-*' | head -1)
jq -e '.status == "invalid"' "$invalid_bundle/run.json" >/dev/null || fail "invalid summary was not classified invalid"
verify_results="$TMP/verify-results"
if BENCH_LOCAL_RESULTS_DIR="$verify_results" BENCH_TEST_FAIL_VERIFY_PHASE=measure "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "failed post-run verification reported success"
fi
verify_bundle=$(find "$verify_results" -mindepth 1 -maxdepth 1 -type d ! -name '.lock' ! -name '.tmp-*' | head -1)
jq -e '.status == "invalid"' "$verify_bundle/run.json" >/dev/null || fail "failed correctness check was not classified invalid"

# The host lock prevents simultaneous runs and reports its owner.
lock_results="$TMP/locked-results"
mkdir -p "$lock_results/.lock"
printf '%s\n' 'pid=123 host=test' > "$lock_results/.lock/owner"
if BENCH_LOCAL_RESULTS_DIR="$lock_results" "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "held benchmark lock was ignored"
fi

# TERM uses the same failure-safe cleanup path.
: > "$TMP/log"
signal_results="$TMP/signal-results"
if BENCH_LOCAL_RESULTS_DIR="$signal_results" BENCH_TEST_SIGNAL_RUN=1 "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "interrupted run reported success"
fi
grep -q '^teardown:teardown:0:' "$TMP/log" || fail "interrupted run skipped teardown"
grep -q '^stop supabase$' "$TMP/log" || fail "interrupted run skipped platform stop"

# Cleanup failures make an otherwise successful run fail and remain visible.
cleanup_results="$TMP/cleanup-results"
if BENCH_LOCAL_RESULTS_DIR="$cleanup_results" BENCH_TEST_FAIL_TEARDOWN=1 "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "teardown failure was hidden"
fi
cleanup_bundle=$(find "$cleanup_results" -mindepth 1 -maxdepth 1 -type d ! -name '.lock' ! -name '.tmp-*' | head -1)
jq -e '.status == "failed" and .lifecycle.teardown == "failed"' "$cleanup_bundle/run.json" >/dev/null || fail "teardown failure was not recorded"
invalid_cleanup_results="$TMP/invalid-cleanup-results"
if BENCH_LOCAL_RESULTS_DIR="$invalid_cleanup_results" BENCH_TEST_OMIT_METRIC=1 BENCH_TEST_FAIL_TEARDOWN=1 "$BENCH" run core-v1 read-throughput supabase rest-api >/dev/null 2>&1; then
  fail "invalid run with teardown failure reported success"
fi
invalid_cleanup_bundle=$(find "$invalid_cleanup_results" -mindepth 1 -maxdepth 1 -type d ! -name '.lock' ! -name '.tmp-*' | head -1)
jq -e '.status == "invalid" and .lifecycle.teardown == "failed"' "$invalid_cleanup_bundle/run.json" >/dev/null || fail "cleanup failure hid the primary invalid result"

# Debug keep mode deliberately skips cleanup and is never publishable.
: > "$TMP/log"
keep_results="$TMP/keep-results"
keep_bundle=$(BENCH_LOCAL_RESULTS_DIR="$keep_results" "$BENCH" run core-v1 read-throughput supabase rest-api --keep)
jq -e '.status == "debug" and .debug == true and (.arguments | index("--keep")) and .lifecycle.teardown == "skipped" and .lifecycle.stop == "skipped"' "$keep_bundle/run.json" >/dev/null || fail "keep run was not marked debug with its arguments"
if grep -q '^teardown:' "$TMP/log" || grep -q '^stop supabase$' "$TMP/log"; then fail "keep mode cleaned up resources"; fi
if BENCH_LOCAL_RESULTS_DIR="$keep_results" "$BENCH" publish "$keep_bundle" >/dev/null 2>&1; then fail "debug run was published"; fi

published=$($BENCH publish "$run_dir")
expected="$BENCH_RESULTS_DIR/core-v1/read-throughput/supabase/rest-api/$(basename "$run_dir")"
[ "$published" = "$expected" ] || fail "unexpected publish destination"
[ -f "$expected/run.json" ] || fail "published run manifest missing"
[ -f "$expected/trials/001/summary.json" ] || fail "first published summary missing"
[ -f "$expected/trials/002/summary.json" ] || fail "second published summary missing"
[ -f "$expected/definitions/benchmark-sets/core-v1/shared/runner.txt" ] || fail "published shared definitions missing"
[ ! -d "$expected/trials/001/raw" ] || fail "raw output was committed"
if "$BENCH" publish "$run_dir" >/dev/null 2>&1; then fail "existing publication was overwritten"; fi
if BENCH_LOCAL_RESULTS_DIR="$invalid_results" "$BENCH" publish "$invalid_bundle" >/dev/null 2>&1; then fail "invalid run was published"; fi
if "$BENCH" publish "$TMP" >/dev/null 2>&1; then fail "outside bundle was published"; fi

copy_bundle() {
  name=$1
  destination=$BENCH_LOCAL_RESULTS_DIR/$name
  cp -R "$run_dir" "$destination"
  jq --arg run_id "$name" '.run_id = $run_id' "$destination/run.json" > "$destination/run.json.tmp"
  mv "$destination/run.json.tmp" "$destination/run.json"
  printf '%s\n' "$destination"
}

# Publication revalidates identity, summaries, definitions, checksums, and Git state.
wrong_name="$BENCH_LOCAL_RESULTS_DIR/wrong-name"
cp -R "$run_dir" "$wrong_name"
if "$BENCH" publish "$wrong_name" >/dev/null 2>&1; then fail "bundle name/run id mismatch was published"; fi
bad_summary=$(copy_bundle bad-summary)
jq '.metrics = {}' "$bad_summary/trials/001/summary.json" > "$bad_summary/trials/001/summary.json.tmp"
mv "$bad_summary/trials/001/summary.json.tmp" "$bad_summary/trials/001/summary.json"
if "$BENCH" publish "$bad_summary" >/dev/null 2>&1; then fail "malformed trial summary was published"; fi
bad_definitions=$(copy_bundle bad-definitions)
printf '%s\n' '# tampered' >> "$bad_definitions/definitions/benchmark-sets/core-v1/benchmarks/read-throughput/METHODOLOGY.md"
if "$BENCH" publish "$bad_definitions" >/dev/null 2>&1; then fail "tampered definitions were published"; fi
forged_definitions=$(copy_bundle forged-definitions)
printf '%s\n' '# forged but internally checksummed' >> "$forged_definitions/definitions/benchmark-sets/core-v1/benchmarks/read-throughput/METHODOLOGY.md"
(cd "$forged_definitions/definitions" && find . -type f -print | LC_ALL=C sort | while IFS= read -r file; do printf '%s  %s\n' "$(test_sha256 "$file")" "$file"; done) > "$forged_definitions/definitions.sha256"
forged_checksum=$(test_sha256 "$forged_definitions/definitions.sha256")
jq --arg checksum "$forged_checksum" '.definitions_sha256 = $checksum' "$forged_definitions/run.json" > "$forged_definitions/run.json.tmp"
mv "$forged_definitions/run.json.tmp" "$forged_definitions/run.json"
if "$BENCH" publish "$forged_definitions" >/dev/null 2>&1; then fail "definitions differing from the recorded commit were published"; fi
missing_method=$(copy_bundle missing-methodology)
rm "$missing_method/definitions/benchmark-sets/core-v1/benchmarks/read-throughput/METHODOLOGY.md"
if "$BENCH" publish "$missing_method" >/dev/null 2>&1; then fail "bundle with missing methodology was published"; fi
bad_commit=$(copy_bundle bad-commit)
jq '.commit = "0000000000000000000000000000000000000000"' "$bad_commit/run.json" > "$bad_commit/run.json.tmp"
mv "$bad_commit/run.json.tmp" "$bad_commit/run.json"
if "$BENCH" publish "$bad_commit" >/dev/null 2>&1; then fail "run from a different commit was published"; fi
bad_environment=$(copy_bundle bad-environment)
jq '.git_commit = "0000000000000000000000000000000000000000"' "$bad_environment/environment.json" > "$bad_environment/environment.json.tmp"
mv "$bad_environment/environment.json.tmp" "$bad_environment/environment.json"
if "$BENCH" publish "$bad_environment" >/dev/null 2>&1; then fail "inconsistent environment provenance was published"; fi
bad_lifecycle=$(copy_bundle bad-lifecycle)
jq '.lifecycle.stop = "failed"' "$bad_lifecycle/run.json" > "$bad_lifecycle/run.json.tmp"
mv "$bad_lifecycle/run.json.tmp" "$bad_lifecycle/run.json"
if "$BENCH" publish "$bad_lifecycle" >/dev/null 2>&1; then fail "run with incomplete lifecycle was published"; fi
current_dirty=$(copy_bundle current-dirty)
printf '%s\n' 'changed' >> "$CASE/README.md"
if "$BENCH" publish "$current_dirty" >/dev/null 2>&1; then fail "run with dirty current definitions was published"; fi
git -C "$TMP" checkout -q -- benchmark-sets
current_shared_dirty=$(copy_bundle current-shared-dirty)
printf '%s\n' 'changed' >> "$SET/shared/runner.txt"
if "$BENCH" publish "$current_shared_dirty" >/dev/null 2>&1; then fail "run with dirty shared definitions was published"; fi
git -C "$TMP" checkout -q -- benchmark-sets

# Publication metadata must not escape the results root.
malicious="$BENCH_LOCAL_RESULTS_DIR/malicious"
mkdir -p "$malicious/definitions" "$malicious/trials/001"
cp "$run_dir/environment.json" "$malicious/environment.json"
cp "$run_dir/definitions.sha256" "$malicious/definitions.sha256"
cp "$run_dir/trials/001/summary.json" "$malicious/trials/001/summary.json"
printf '%s\n' '{"status":"complete","debug":false,"set":"..","benchmark":"escape","platform":"x","variant":"y","run_id":"z"}' > "$malicious/run.json"
if "$BENCH" publish "$malicious" >/dev/null 2>&1; then fail "malicious metadata published"; fi
[ ! -e "$TMP/escape" ] || fail "publication escaped root"
grep -qx '.results/' "$ROOT/.gitignore" || fail "local benchmark results are not ignored"
[ -d "$ROOT/results" ] || fail "published results directory missing"

printf '%s\n' PASS

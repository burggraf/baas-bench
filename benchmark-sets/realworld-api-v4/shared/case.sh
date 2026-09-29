#!/bin/sh
set -eu

[ "$#" -eq 2 ] || { echo "usage: case.sh <action> <platform>" >&2; exit 2; }
action=$1
platform=$2
case "$action" in setup|verify|reset|run|teardown) ;; *) echo "invalid action: $action" >&2; exit 2 ;; esac
case "$platform" in supabase|convex|appwrite|nhost|directus|pocketbase|trailbase|neon) ;; *) echo "invalid platform: $platform" >&2; exit 2 ;; esac

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
set_root=$(CDPATH= cd "$script_dir/.." && pwd)
repo_root=$(CDPATH= cd "$set_root/../.." && pwd)
runtime_root=${BAAS_RUNTIME_DIR:-"$repo_root/.runtime"}
runtime=$runtime_root/benchmarks/realworld-api-v4

node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[ "$node_major" -ge 22 ] || { echo "realworld-api-v4 requires Node.js 22 or newer" >&2; exit 1; }

umask 077
if [ "$action" = setup ]; then
  install=0
  [ -d "$runtime/node_modules" ] || install=1
  if [ ! -f "$runtime/package-lock.json" ] || ! cmp -s "$script_dir/package-lock.json" "$runtime/package-lock.json"; then
    install=1
  fi
  mkdir -p "$runtime"
  rm -rf "$runtime/lib" "$runtime/convex" "$runtime/trailbase" "$runtime/pocketbase" "$runtime/sql" "$runtime/directus"
  cp "$script_dir/package.json" "$script_dir/package-lock.json" "$runtime/"
  cp -R "$script_dir/lib" "$runtime/"
  if [ -d "$script_dir/convex" ]; then cp -R "$script_dir/convex" "$runtime/"; fi
  if [ -d "$script_dir/trailbase" ]; then cp -R "$script_dir/trailbase" "$runtime/"; fi
  if [ -d "$script_dir/pocketbase" ]; then cp -R "$script_dir/pocketbase" "$runtime/"; fi
  if [ -d "$script_dir/sql" ]; then cp -R "$script_dir/sql" "$runtime/"; fi
  if [ -d "$script_dir/directus" ]; then cp -R "$script_dir/directus" "$runtime/"; fi
  if [ "$install" -eq 1 ]; then npm ci --ignore-scripts --prefix "$runtime"; fi
fi

[ -d "$runtime/lib" ] || { echo "benchmark runtime is not installed; run setup first" >&2; exit 1; }
export BAAS_BENCH_ROOT=$repo_root
export BAAS_BENCH_RUNTIME=$runtime
phase=${BENCH_PHASE:-}
trial=${BENCH_TRIAL:-}
output_dir=${BENCH_OUTPUT_DIR:-}
runner_target=${BAAS_BENCH_V4_RUNNER_TARGET:-}
runner_root=${BAAS_BENCH_V4_RUNNER_ROOT:-}

validate_runner() {
  [ -n "$runner_target" ] || { echo "V4 run requires BAAS_BENCH_V4_RUNNER_TARGET" >&2; exit 1; }
  printf '%s' "$runner_target" | grep -Eq '^([A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*$' || { echo "invalid runner SSH target" >&2; exit 1; }
  [ -n "$runner_root" ] || { echo "V4 run requires BAAS_BENCH_V4_RUNNER_ROOT" >&2; exit 1; }
  case "$runner_root" in /*) ;; *) echo "runner root must be absolute" >&2; exit 1 ;; esac
  case "$runner_root" in *[!A-Za-z0-9_./-]*|*../*|*/..|*/./*|*/.|*/|*//*) echo "invalid runner root" >&2; exit 1 ;; esac
}

sync_runner() {
  remote_runtime=$runner_root/.runtime/benchmarks/realworld-api-v4
  ssh -o BatchMode=yes -o ConnectTimeout=5 "$runner_target" "umask 077 && mkdir -p '$remote_runtime' && chmod 700 '$runner_root/.runtime' '$runner_root/.runtime/benchmarks' '$remote_runtime'"
  rsync -a --delete -- "$runtime/" "$runner_target:$remote_runtime/"
}

if [ "$action" = run ]; then
  validate_runner
  exec node "$runtime/lib/remote-execution.mjs" "$platform" "$phase" "$trial" "$output_dir" "$runner_target" "$runner_root"
fi
if [ "$action" = setup ]; then
  validate_runner
  node "$runtime/lib/remote-config.mjs" prepare "$platform" "$runtime" "$repo_root" "$runner_root"
fi
node "$runtime/lib/admin.mjs" "$action" "$platform" "$phase" "$trial" "$output_dir"
if [ "$action" = setup ]; then sync_runner; fi

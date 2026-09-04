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
runtime=$runtime_root/benchmarks/realworld-api-v3

node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[ "$node_major" -ge 22 ] || { echo "realworld-api-v3 requires Node.js 22 or newer" >&2; exit 1; }

umask 077
if [ "$action" = setup ]; then
  install=0
  [ -d "$runtime/node_modules" ] || install=1
  if [ ! -f "$runtime/package-lock.json" ] || ! cmp -s "$script_dir/package-lock.json" "$runtime/package-lock.json"; then
    install=1
  fi
  mkdir -p "$runtime"
  rm -rf "$runtime/lib" "$runtime/convex" "$runtime/trailbase" "$runtime/pocketbase" "$runtime/sql"
  cp "$script_dir/package.json" "$script_dir/package-lock.json" "$runtime/"
  cp -R "$script_dir/lib" "$runtime/"
  if [ -d "$script_dir/convex" ]; then cp -R "$script_dir/convex" "$runtime/"; fi
  if [ -d "$script_dir/trailbase" ]; then cp -R "$script_dir/trailbase" "$runtime/"; fi
  if [ -d "$script_dir/pocketbase" ]; then cp -R "$script_dir/pocketbase" "$runtime/"; fi
  if [ -d "$script_dir/sql" ]; then cp -R "$script_dir/sql" "$runtime/"; fi
  if [ "$install" -eq 1 ]; then npm ci --ignore-scripts --prefix "$runtime"; fi
fi

[ -d "$runtime/lib" ] || { echo "benchmark runtime is not installed; run setup first" >&2; exit 1; }
export BAAS_BENCH_ROOT=$repo_root
export BAAS_BENCH_RUNTIME=$runtime
phase=${BENCH_PHASE:-}
trial=${BENCH_TRIAL:-}
output_dir=${BENCH_OUTPUT_DIR:-}

if [ "$action" = run ]; then
  exec node "$runtime/lib/run.mjs" "$platform" "$phase" "$trial" "$output_dir"
fi
exec node "$runtime/lib/admin.mjs" "$action" "$platform" "$phase" "$trial" "$output_dir"

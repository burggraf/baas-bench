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
backend_target=${BAAS_BENCH_V4_BACKEND_TARGET:-}
backend_root=${BAAS_BENCH_V4_BACKEND_ROOT:-}
backend_private_ip=${BAAS_BENCH_V4_BACKEND_PRIVATE_IP:-}
backend_docker_target=${BAAS_BENCH_V4_BACKEND_DOCKER_SSH_TARGET:-}
runner_ssh_key=${BAAS_BENCH_V4_RUNNER_SSH_KEY_FILE:-}

ssh_config=${BAAS_BENCH_V4_SSH_CONFIG:-}
v4_ssh() {
  node "$runtime/lib/ssh-config.mjs" validate "$ssh_config" || return 1
  command ssh -F "$ssh_config" "$@"
}
if [ -n "$runner_target$backend_target" ]; then
  node "$runtime/lib/ssh-config.mjs" validate "$ssh_config"
fi

validate_runner() {
  [ -n "$runner_target" ] || { echo "V4 run requires BAAS_BENCH_V4_RUNNER_TARGET" >&2; exit 1; }
  printf '%s' "$runner_target" | grep -Eq '^([A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*$' || { echo "invalid runner SSH target" >&2; exit 1; }
  [ -n "$runner_root" ] || { echo "V4 run requires BAAS_BENCH_V4_RUNNER_ROOT" >&2; exit 1; }
  case "$runner_root" in /*) ;; *) echo "runner root must be absolute" >&2; exit 1 ;; esac
  case "$runner_root" in *[!A-Za-z0-9_./-]*|*../*|*/..|*/./*|*/.|*/|*//*) echo "invalid runner root" >&2; exit 1 ;; esac
}

validate_backend() {
  [ -n "$backend_target" ] || { echo "V4 setup requires BAAS_BENCH_V4_BACKEND_TARGET" >&2; exit 1; }
  printf '%s' "$backend_target" | grep -Eq '^([A-Za-z0-9][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$' || { echo "invalid backend SSH target" >&2; exit 1; }
  [ -n "$backend_root" ] || { echo "V4 setup requires BAAS_BENCH_V4_BACKEND_ROOT" >&2; exit 1; }
  case "$backend_root" in /*) ;; *) echo "backend root must be absolute" >&2; exit 1 ;; esac
  case "$backend_root" in *[!A-Za-z0-9_./-]*|*../*|*/..|*/./*|*/.|*/|*//*) echo "invalid backend root" >&2; exit 1 ;; esac
  [ -n "$backend_private_ip" ] || { echo "V4 remote setup requires BAAS_BENCH_V4_BACKEND_PRIVATE_IP" >&2; exit 1; }
  printf '%s' "$backend_docker_target" | grep -Eq '^([A-Za-z0-9][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$' || { echo "invalid backend Docker SSH target" >&2; exit 1; }
}

copy_backend_ca() {
  source_ca=$1
  temporary_ca=$runtime/.ca.pem.$$
  trap 'rm -f "$temporary_ca"' 0 1 2 15
  v4_ssh -o BatchMode=yes -o ConnectTimeout=5 "$backend_target" "cat -- '$source_ca'" > "$temporary_ca"
  [ -s "$temporary_ca" ] || { echo "backend private CA is empty" >&2; exit 1; }
  chmod 600 "$temporary_ca"
  mv "$temporary_ca" "$runtime/ca.pem"
  trap - 0 1 2 15
}

prepare_supabase_runner_config() {
  validate_backend
  backend_runtime=$backend_root/.runtime/benchmarks/realworld-api-v4
  copy_backend_ca "$backend_runtime/ca.pem"
  publishable_key=$(v4_ssh -o BatchMode=yes -o ConnectTimeout=5 "$backend_target" "grep '^SUPABASE_PUBLISHABLE_KEY=' '$backend_root/.runtime/supabase/docker/.env'" | sed 's/^SUPABASE_PUBLISHABLE_KEY=//')
  printf '%s\n' "$publishable_key" | node "$runtime/lib/remote-config.mjs" create supabase "$runtime" "$runner_root" "$backend_private_ip" "$backend_docker_target" "$backend_root"
}

prepare_trailbase_runner_config() {
  validate_backend
  backend_tls_dir=$backend_root/.runtime/benchmarks/realworld-api-v4/trailbase
  copy_backend_ca "$backend_tls_dir/ca.pem"
  printf '\n' | node "$runtime/lib/remote-config.mjs" create trailbase "$runtime" "$runner_root" "$backend_private_ip" "$backend_docker_target" "$backend_root"
}

configure_runner_backend_ssh() {
  [ -f "$runner_ssh_key" ] || { echo "V4 setup requires BAAS_BENCH_V4_RUNNER_SSH_KEY_FILE" >&2; exit 1; }
  node "$runtime/lib/ssh-config.mjs" runner "$ssh_config" "$backend_target" "$backend_private_ip" "$runner_root"
  ssh_directory=$(dirname "$ssh_config")
  cat "$runner_ssh_key" | v4_ssh -o BatchMode=yes -o ConnectTimeout=5 "$runner_target" "cat > '$remote_runtime/id_ed25519' && chmod 600 '$remote_runtime/id_ed25519'"
  cat "$ssh_directory/runner_known_hosts" | v4_ssh -o BatchMode=yes -o ConnectTimeout=5 "$runner_target" "cat > '$remote_runtime/known_hosts' && chmod 600 '$remote_runtime/known_hosts'"
  cat "$ssh_directory/runner_ssh_config" | v4_ssh -o BatchMode=yes -o ConnectTimeout=5 "$runner_target" "cat > '$remote_runtime/ssh_config' && chmod 600 '$remote_runtime/ssh_config'"
}

sync_runner() {
  remote_runtime=$runner_root/.runtime/benchmarks/realworld-api-v4
  v4_ssh -o BatchMode=yes -o ConnectTimeout=5 "$runner_target" "umask 077 && mkdir -p '$remote_runtime' && chmod 700 '$runner_root/.runtime' '$runner_root/.runtime/benchmarks' '$remote_runtime'"
  node "$runtime/lib/ssh-config.mjs" validate "$ssh_config"
  rsync -e "ssh -F $ssh_config" -a --delete --exclude node_modules -- "$runtime/" "$runner_target:$remote_runtime/"
  case "$platform" in supabase|trailbase) configure_runner_backend_ssh ;; esac
  v4_ssh -o BatchMode=yes -o ConnectTimeout=5 "$runner_target" "node -e 'if (Number(process.versions.node.split(\".\")[0]) < 22) process.exit(1)' && npm ci --ignore-scripts --prefix '$remote_runtime'"
}

stop_trailbase_admin_tunnel() {
  [ -n "${trailbase_tunnel_pid:-}" ] || return 0
  kill "$trailbase_tunnel_pid" 2>/dev/null || true
  wait "$trailbase_tunnel_pid" 2>/dev/null || true
  trailbase_tunnel_pid=
}

cleanup_trailbase_admin() {
  stop_trailbase_admin_tunnel
  if [ "$action" = teardown ]; then rm -f "$runtime_root/trailbase-v4/bootstrap-admin.json"; fi
}

start_trailbase_admin_tunnel() {
  validate_backend
  local_port=$(node -e 'const s=require("node:net").createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port); s.close()})')
  case "$local_port" in ''|*[!0-9]*) echo 'could not allocate a local TrailBase admin port' >&2; return 1 ;; esac
  node "$runtime/lib/ssh-config.mjs" validate "$ssh_config"
  ssh -F "$ssh_config" -o BatchMode=yes -o ConnectTimeout=5 -o ExitOnForwardFailure=yes -N -L "127.0.0.1:$local_port:127.0.0.1:4000" "$backend_target" >/dev/null 2>&1 &
  trailbase_tunnel_pid=$!
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if ! kill -0 "$trailbase_tunnel_pid" 2>/dev/null; then echo 'TrailBase admin SSH tunnel exited before becoming ready' >&2; return 1; fi
    if node -e 'const s=require("node:net").createConnection({host:"127.0.0.1",port:Number(process.argv[1])}); s.setTimeout(1000); s.once("connect",()=>{s.destroy();process.exit(0)}); s.once("error",()=>process.exit(1)); s.once("timeout",()=>{s.destroy();process.exit(1)});' "$local_port" >/dev/null 2>&1; then break; fi
    attempt=$((attempt + 1))
    sleep 1
  done
  [ "$attempt" -lt 30 ] || { echo 'TrailBase admin SSH tunnel did not become ready' >&2; return 1; }
  TRAILBASE_URL="http://127.0.0.1:$local_port"
  export TRAILBASE_URL
}

prepare_trailbase_bootstrap_credentials() {
  bootstrap_dir=$runtime_root/trailbase-v4
  bootstrap_file=$bootstrap_dir/bootstrap-admin.json
  mkdir -p "$bootstrap_dir"
  chmod 700 "$bootstrap_dir"
  rm -f "$bootstrap_file"
  bootstrap_log=$("$repo_root/bin/baas" compose trailbase logs --no-color --tail 200 trailbase)
  printf '%s\n' "$bootstrap_log" | node "$runtime/lib/admin/trailbase-bootstrap.mjs" "$bootstrap_file"
  unset bootstrap_log
  chmod 600 "$bootstrap_file"
  TRAILBASE_BOOTSTRAP_FILE=$bootstrap_file
  export TRAILBASE_BOOTSTRAP_FILE
}

if [ "$action" = run ]; then
  validate_runner
  exec node "$runtime/lib/remote-execution.mjs" "$platform" "$phase" "$trial" "$output_dir" "$runner_target" "$runner_root"
fi
if [ "$platform" = trailbase ] && [ -n "$backend_target" ]; then
  trap 'cleanup_trailbase_admin' 0
  trap 'exit 129' 1
  trap 'exit 130' 2
  trap 'exit 143' 15
  start_trailbase_admin_tunnel
  TRAILBASE_BOOTSTRAP_FILE=$runtime_root/trailbase-v4/bootstrap-admin.json
  export TRAILBASE_BOOTSTRAP_FILE
  if [ "$action" = setup ]; then prepare_trailbase_bootstrap_credentials; fi
fi
if node "$runtime/lib/admin.mjs" "$action" "$platform" "$phase" "$trial" "$output_dir"; then
  :
else
  admin_status=$?
  if [ "$action" = setup ] && [ "$platform" = supabase ] && [ -n "$backend_target" ]; then
    node "$runtime/lib/host-telemetry.mjs" diagnose "$backend_target" || echo 'V4 backend failure diagnostics failed' >&2
  fi
  exit "$admin_status"
fi
if [ "$platform" = trailbase ] && [ -n "$backend_target" ]; then
  cleanup_trailbase_admin
  trap - 0 1 2 15
fi
if [ "$action" = setup ]; then
  node "$runtime/lib/progress.mjs" lifecycle sync-runner || :
  validate_runner
  case "$platform" in
    supabase) prepare_supabase_runner_config ;;
    trailbase) prepare_trailbase_runner_config ;;
  esac
  node "$runtime/lib/remote-config.mjs" prepare "$platform" "$runtime" "$repo_root" "$runner_root"
  sync_runner
fi

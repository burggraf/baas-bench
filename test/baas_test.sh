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
grep -q '^NHOST_TRAEFIK_IMAGE=traefik:v3\.6\.1@sha256:' "$ROOT/versions.env" || fail "V3 Nhost Traefik compatibility image changed"
grep -q '^TRAILBASE_VERSION=0\.34\.1$' "$ROOT/benchmark-sets/realworld-api-v4/versions.env" || fail "V4 TrailBase version is not current"
grep -Eq '^NEON_BUILD_TOOLS_IMAGE=ghcr\.io/neondatabase/build-tools:pinned@sha256:[0-9a-f]{64}$' "$ROOT/versions.env" || fail "Neon proxy build tools image is not fully pinned"
grep -Eq '^NEON_IMAGE=[^[:space:]@]+@sha256:[0-9a-f]{64}$' "$ROOT/versions.env" || fail "Neon proxy runtime image is not fully pinned"
grep -Eq '^NEON_REF=[0-9a-f]{40}$' "$ROOT/versions.env" || fail "Neon source ref is not an immutable commit"
grep -q 'ADMIN_EMAIL: admin@example.com' "$ROOT/services/directus/compose.yml" || fail "Directus bootstrap email is invalid"

if "$BAAS" setup unknown >/dev/null 2>&1; then
  fail "unknown service was accepted"
fi

mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'EOF'
#!/bin/sh
echo "docker $*" >> "$BAAS_TEST_LOG"
if [ -n "${NEON_SOURCE_DIR:-}" ] || [ -n "${NEON_PROXY_DOCKERFILE:-}" ]; then
  echo "neon-build-inputs source=${NEON_SOURCE_DIR:-} dockerfile=${NEON_PROXY_DOCKERFILE:-}" >> "$BAAS_TEST_LOG"
fi
case "$*" in *' exec '*) printf '%s\n' 1;; esac
docker_args=$*
compose_env_files=
neon_overlay=false
compose_config=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) compose_env_files="$compose_env_files $2"; shift 2 ;;
    */services/neon/proxy.yml) neon_overlay=true; shift ;;
    config) compose_config=true; shift ;;
    *) shift ;;
  esac
done
if [ "$neon_overlay" = true ] && [ "$compose_config" = true ]; then
  (
    set -a
    for compose_env_file in $compose_env_files; do
      # Test fixtures contain shell-compatible Compose environment assignments.
      . "$compose_env_file"
    done
    printf '%s\n' "neon-resolved-build-args build_tools=$NEON_BUILD_TOOLS_IMAGE runtime=${REPOSITORY:-ghcr.io/neondatabase}/neon:$NEON_IMAGE ref=$NEON_REF" >> "$BAAS_TEST_LOG"
  )
fi
case "$docker_args" in
  *services/trailbase/compose.yml*)
    (
      set -a
      for compose_env_file in $compose_env_files; do . "$compose_env_file"; done
      printf '%s\n' "trailbase-resolved-version=$TRAILBASE_VERSION" >> "$BAAS_TEST_LOG"
    )
    ;;
  *services/pocketbase/compose.yml*)
    (
      set -a
      for compose_env_file in $compose_env_files; do . "$compose_env_file"; done
      printf '%s\n' "pocketbase-resolved-dockerfile=${POCKETBASE_DOCKERFILE:-default}" >> "$BAAS_TEST_LOG"
    )
    ;;
esac
exit 0
EOF
cat > "$TMP/bin/envoy" <<'EOF'
#!/bin/sh
[ "$1" = -c ] || exit 1
config=$(dirname "$2")/lds.yaml
grep -q '^version_info: "1"$' "$config" || exit 1
grep -q '^resources:$' "$config" || exit 1
grep -q '^    name: supabase$' "$config" || exit 1
grep -q '^    name: supabase_tls$' "$config" || exit 1
grep -q 'envoy.filters.listener.tls_inspector' "$config" || exit 1
grep -q 'transport_protocol: tls' "$config" || exit 1
grep -q 'filename: .*/tls/server.crt' "$config" || exit 1
EOF
cat > "$TMP/bin/ssh" <<'EOF'
#!/bin/sh
printf 'ssh' >> "$BAAS_TEST_SSH_LOG"
for argument do printf ' <%s>' "$argument" >> "$BAAS_TEST_SSH_LOG"; done
printf '\n' >> "$BAAS_TEST_SSH_LOG"
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
  req|x509)
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
    if [ -n "$keyout" ]; then printf '%s\n' 'test private key' > "$keyout"; fi
    ;;
esac
EOF
chmod +x "$TMP/bin/docker" "$TMP/bin/envoy" "$TMP/bin/ssh" "$TMP/bin/curl" "$TMP/bin/openssl"

export PATH="$TMP/bin:$PATH"
export BAAS_RUNTIME_DIR="$TMP/runtime"
export BAAS_TEST_LOG="$TMP/calls"
export BAAS_TEST_SSH_LOG="$TMP/ssh-calls"
mkdir -p "$TMP/envoy"
cat > "$TMP/envoy/lds.template.yaml" <<'EOF'
resources:
  - '@type': type.googleapis.com/envoy.config.listener.v3.Listener
    name: supabase
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 8000
    filter_chains:
      - filters:
          - name: envoy.filters.network.http_connection_manager
EOF
sed "s|/etc/envoy|$TMP/envoy|g" "$ROOT/services/supabase/envoy-tls-entrypoint.sh" > "$TMP/envoy-entrypoint.sh"
DASHBOARD_USERNAME=admin DASHBOARD_PASSWORD=password ANON_KEY=anon ANON_KEY_ASYMMETRIC=anon SERVICE_ROLE_KEY=service SERVICE_ROLE_KEY_ASYMMETRIC=service SUPABASE_PUBLISHABLE_KEY=publishable SUPABASE_SECRET_KEY=secret sh "$TMP/envoy-entrypoint.sh" || fail "V4 Supabase Envoy TLS config did not render"
"$BAAS" start directus >/dev/null

stop_line=$(grep -n ' stop' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
up_line=$(grep -n ' up -d' "$BAAS_TEST_LOG" | head -1 | cut -d: -f1)
[ -n "$stop_line" ] && [ -n "$up_line" ] && [ "$stop_line" -lt "$up_line" ] || fail "start did not stop stacks first"
grep -q "docker compose .*--env-file $BAAS_RUNTIME_DIR/directus/.env .*services/directus/compose.yml" "$BAAS_TEST_LOG" || fail "Directus runtime environment missing"
if grep 'docker compose .*services/directus/compose.yml' "$BAAS_TEST_LOG" | grep -q 'services/neon/proxy.yml'; then fail "Neon overlay leaked into Directus Compose"; fi
grep -q 'curl .*localhost:8055/server/ping' "$BAAS_TEST_LOG" || fail "Directus smoke call missing"
[ "$(ls -l "$BAAS_RUNTIME_DIR/directus/.env" | cut -c5-10)" = '------' ] || fail "Directus secrets are not private"
: > "$BAAS_TEST_LOG"
BAAS_VERSION_PROFILE=realworld-api-v4 "$BAAS" setup trailbase >/dev/null
grep -q 'docker compose .*--env-file .*versions.env --env-file .*realworld-api-v4/versions.env .*services/trailbase/compose.yml config --quiet' "$BAAS_TEST_LOG" || fail "V4 service versions were not overlaid for Compose"
grep -q '^trailbase-resolved-version=0.34.1$' "$BAAS_TEST_LOG" || fail "V4 TrailBase version was not used"
: > "$BAAS_TEST_LOG"
BAAS_VERSION_PROFILE=realworld-api-v4 "$BAAS" setup pocketbase >/dev/null
grep -q '^pocketbase-resolved-dockerfile=benchmark-sets/realworld-api-v4/shared/pocketbase-go/Dockerfile$' "$BAAS_TEST_LOG" || fail "V4 PocketBase helper was not selected"
mkdir -p "$BAAS_RUNTIME_DIR/supabase/docker/volumes/api/envoy"
SUPABASE_V4_REF=$(awk -F= '$1 == "SUPABASE_REF" { print $2 }' "$ROOT/benchmark-sets/realworld-api-v4/versions.env")
printf '%s\n' "$SUPABASE_V4_REF" > "$BAAS_RUNTIME_DIR/supabase/.baas-ref"
cat > "$BAAS_RUNTIME_DIR/supabase/docker/docker-compose.yml" <<'EOF'
services:
  api-gw:
    image: envoyproxy/envoy:v1.39.1
    ports:
      - ${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000/tcp
    volumes:
      - ./volumes/api/envoy/docker-entrypoint.sh:/docker-entrypoint.sh:ro
EOF
printf '%s\n' 'SUPABASE_PUBLISHABLE_KEY=test-key' > "$BAAS_RUNTIME_DIR/supabase/docker/.env"
BAAS_VERSION_PROFILE=realworld-api-v4 BAAS_BENCH_V4_BACKEND_PRIVATE_IP=10.0.0.10 "$BAAS" setup supabase >/dev/null
BAAS_VERSION_PROFILE=realworld-api-v4 BAAS_BENCH_V4_BACKEND_PRIVATE_IP=10.0.0.10 "$BAAS" setup supabase >/dev/null
grep -Fq '${API_GW_HTTPS_BIND_IP:-127.0.0.1}:${API_GW_HTTPS_PORT:-8443}:8443/tcp' "$BAAS_RUNTIME_DIR/supabase/docker/docker-compose.yml" || fail "V4 Supabase HTTPS port missing"
grep -Fq './volumes/api/envoy/tls:/etc/envoy/tls:ro' "$BAAS_RUNTIME_DIR/supabase/docker/docker-compose.yml" || fail "V4 Supabase TLS mount missing"
grep -Fq 'image: envoyproxy/envoy@sha256:57e14a549d7bd43c8d3f6d03e8cfa653e037d4b38e133acd9b54f38c524401b4' "$BAAS_RUNTIME_DIR/supabase/docker/docker-compose.yml" || fail "V4 Supabase Envoy image is not digest-pinned"
grep -Fq 'API_GW_HTTP_PORT=127.0.0.1:8000' "$BAAS_RUNTIME_DIR/supabase/docker/.env" || fail "V4 Supabase HTTP listener is public"
grep -Fq 'API_EXTERNAL_URL=https://10.0.0.10:8443' "$BAAS_RUNTIME_DIR/supabase/docker/.env" || fail "V4 Supabase native HTTPS URL missing"
[ -f "$BAAS_RUNTIME_DIR/benchmarks/realworld-api-v4/ca.pem" ] || fail "V4 Supabase private CA missing"
[ -f "$BAAS_RUNTIME_DIR/supabase/docker/volumes/api/envoy/tls/server.crt" ] || fail "V4 Supabase native TLS certificate missing"
grep -Fq 'envoy.filters.listener.tls_inspector' "$BAAS_RUNTIME_DIR/supabase/docker/volumes/api/envoy/docker-entrypoint.sh" || fail "V4 Supabase Envoy TLS listener missing"
grep -Fq 'transport_protocol: tls' "$BAAS_RUNTIME_DIR/supabase/docker/volumes/api/envoy/docker-entrypoint.sh" || fail "V4 Supabase TLS filter chain is not selected"
: > "$BAAS_TEST_LOG"
: > "$BAAS_TEST_SSH_LOG"
BAAS_VERSION_PROFILE=realworld-api-v4 BAAS_BENCH_V4_BACKEND_TARGET=root@192.0.2.8 BAAS_BENCH_V4_BACKEND_ROOT=/opt/baas-bench BAAS_BENCH_V4_BACKEND_PRIVATE_IP=10.0.0.10 "$BAAS" start supabase >/dev/null
[ ! -s "$BAAS_TEST_LOG" ] || fail "remote backend start touched local Docker"
grep -Fq 'root@192.0.2.8' "$BAAS_TEST_SSH_LOG" || fail "V4 backend command did not use SSH"
grep -Fq "BAAS_RUNTIME_DIR='/opt/baas-bench/.runtime'" "$BAAS_TEST_SSH_LOG" || fail "V4 backend runtime path was not forwarded"
grep -Fq "BAAS_VERSION_PROFILE='realworld-api-v4'" "$BAAS_TEST_SSH_LOG" || fail "V4 profile was not forwarded to backend"
grep -Fq "BAAS_BENCH_V4_BACKEND_PRIVATE_IP='10.0.0.10'" "$BAAS_TEST_SSH_LOG" || fail "V4 backend private IP was not forwarded"
grep -Fq "./bin/baas 'start' 'supabase'" "$BAAS_TEST_SSH_LOG" || fail "remote start command or arguments were not preserved"
: > "$BAAS_TEST_SSH_LOG"
if BAAS_VERSION_PROFILE=realworld-api-v3 BAAS_BENCH_V4_BACKEND_TARGET=root@192.0.2.8 BAAS_BENCH_V4_BACKEND_ROOT=/opt/baas-bench "$BAAS" stop supabase >/dev/null 2>&1; then fail "remote backend proxy was accepted outside V4"; fi
if BAAS_VERSION_PROFILE=realworld-api-v4 BAAS_BENCH_V4_BACKEND_TARGET='root@host;touch' BAAS_BENCH_V4_BACKEND_ROOT=/opt/baas-bench "$BAAS" stop supabase >/dev/null 2>&1; then fail "unsafe SSH target was accepted"; fi
if BAAS_VERSION_PROFILE=realworld-api-v4 BAAS_BENCH_V4_BACKEND_TARGET='-root@host' BAAS_BENCH_V4_BACKEND_ROOT=/opt/baas-bench "$BAAS" stop supabase >/dev/null 2>&1; then fail "option-like SSH target was accepted"; fi
if BAAS_VERSION_PROFILE=realworld-api-v4 BAAS_BENCH_V4_BACKEND_TARGET=root@192.0.2.8 BAAS_BENCH_V4_BACKEND_ROOT=/opt/../tmp "$BAAS" stop supabase >/dev/null 2>&1; then fail "unsafe backend root was accepted"; fi
if BAAS_VERSION_PROFILE=realworld-api-v4 BAAS_BENCH_V4_BACKEND_TARGET=root@192.0.2.8 BAAS_BENCH_V4_BACKEND_ROOT=/opt/baas-bench BAAS_BENCH_V4_BACKEND_PRIVATE_IP=203.0.113.10 "$BAAS" start supabase >/dev/null 2>&1; then fail "public backend IP was accepted"; fi
[ ! -s "$BAAS_TEST_SSH_LOG" ] || fail "invalid remote backend configuration invoked SSH"

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

mkdir -p "$BAAS_RUNTIME_DIR/neon/docker-compose/compute_wrapper/var/db/postgres/configs" "$BAAS_RUNTIME_DIR/neon/proxy"
printf '%s\n' "$NEON_REF" > "$BAAS_RUNTIME_DIR/neon/.baas-ref"
printf '%s\n' '[package]' 'name = "proxy"' > "$BAAS_RUNTIME_DIR/neon/proxy/Cargo.toml"
printf '%s\n' 'services: {}' > "$BAAS_RUNTIME_DIR/neon/docker-compose/docker-compose.yml"
printf '%s\n' '{"encrypted_password": "b093c0d3b281ba6da1eacc608620abd8"}' > "$BAAS_RUNTIME_DIR/neon/docker-compose/compute_wrapper/var/db/postgres/configs/config.json"
: > "$BAAS_TEST_LOG"
"$BAAS" setup neon >/dev/null
"$BAAS" setup neon >/dev/null
neon_compose="$BAAS_RUNTIME_DIR/neon/docker-compose/docker-compose.yml"
grep -q "docker compose .* -f $neon_compose -f $ROOT/services/neon/proxy.yml config --quiet" "$BAAS_TEST_LOG" || fail "Neon proxy overlay missing from Compose command"
grep -q "^neon-build-inputs source=$BAAS_RUNTIME_DIR/neon dockerfile=$ROOT/services/neon/proxy.Dockerfile$" "$BAAS_TEST_LOG" || fail "Neon Compose did not receive repository-owned source and Dockerfile inputs"
grep -Fqx "neon-resolved-build-args build_tools=$NEON_BUILD_TOOLS_IMAGE runtime=ghcr.io/neondatabase/neon:$NEON_IMAGE ref=$NEON_REF" "$BAAS_TEST_LOG" || fail "Neon Compose did not resolve the pinned build arguments"
grep -Fq '"encrypted_password": "SCRAM-SHA-256$4096:' "$BAAS_RUNTIME_DIR/neon/docker-compose/compute_wrapper/var/db/postgres/configs/config.json" || fail "Neon role password was not upgraded to SCRAM for proxy authentication"
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
grep -q 'context: ${NEON_SOURCE_DIR}' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy build context is not the pinned official source"
grep -q 'dockerfile: ${NEON_PROXY_DOCKERFILE}' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy does not use the repository-owned Dockerfile"
grep -q 'NEON_BUILD_TOOLS_IMAGE: ${NEON_BUILD_TOOLS_IMAGE}' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy build does not receive pinned official build tools"
grep -q 'NEON_RUNTIME_IMAGE: ${REPOSITORY:-ghcr.io/neondatabase}/neon:${NEON_IMAGE}' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy build does not receive the pinned official runtime"
grep -q 'NEON_REF: ${NEON_REF}' "$ROOT/services/neon/proxy.yml" || fail "Neon proxy build does not identify the pinned source"
grep -q '^FROM ${NEON_BUILD_TOOLS_IMAGE} AS build$' "$ROOT/services/neon/proxy.Dockerfile" || fail "Neon proxy Dockerfile does not use the pinned build image input"
grep -q '^RUN cargo build --locked --release --package proxy --bin proxy --features testing$' "$ROOT/services/neon/proxy.Dockerfile" || fail "Neon proxy Dockerfile does not configure the official proxy build with the testing feature"
grep -q '^FROM ${NEON_RUNTIME_IMAGE}$' "$ROOT/services/neon/proxy.Dockerfile" || fail "Neon proxy Dockerfile does not use the pinned official runtime input"
[ "$(grep -c '^COPY --from=build ' "$ROOT/services/neon/proxy.Dockerfile")" -eq 1 ] || fail "Neon proxy runtime must copy only one build artifact"
grep -q '/target/release/proxy /usr/local/bin/proxy$' "$ROOT/services/neon/proxy.Dockerfile" || fail "Neon proxy runtime does not copy the compiled official binary"
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

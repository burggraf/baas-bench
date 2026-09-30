#!/bin/sh
set -eu

NODE_VERSION=22.23.1
NODE_SHA256=9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578
DOCKER_VERSION=29.5.0
DOCKER_SHA256=ec7f44cd54edf68a06f0da8b507b9e0aa82b64347c4a5a6becde2e4dc6cb212c
COMPOSE_VERSION=5.1.2
COMPOSE_SHA256=c372e512a36e67716b0b3a1264ccdc461dec7a7beff601b81f7c5fb008e3511e

[ "$(id -u)" -eq 0 ] || { echo 'bootstrap must run as root' >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo 'bootstrap requires x86_64' >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git iproute2 iptables openssh-client openssl rsync xz-utils
install -d -m 0755 /opt/baas-bench-tools /usr/local/lib/docker/cli-plugins
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fetch() {
  url=$1 hash=$2 output=$3
  curl --fail --location --proto '=https' --tlsv1.2 --output "$output" "$url"
  printf '%s  %s\n' "$hash" "$output" | sha256sum -c -
}

fetch "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" "$NODE_SHA256" "$work/node.tar.xz"
tar -xJf "$work/node.tar.xz" -C /opt/baas-bench-tools
ln -sfn "/opt/baas-bench-tools/node-v${NODE_VERSION}-linux-x64/bin/node" /usr/local/bin/node
ln -sfn "/opt/baas-bench-tools/node-v${NODE_VERSION}-linux-x64/bin/npm" /usr/local/bin/npm
ln -sfn "/opt/baas-bench-tools/node-v${NODE_VERSION}-linux-x64/bin/npx" /usr/local/bin/npx

fetch "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" "$DOCKER_SHA256" "$work/docker.tgz"
tar -xzf "$work/docker.tgz" -C "$work"
install -m 0755 "$work/docker/"* /usr/local/bin/
fetch "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-x86_64" "$COMPOSE_SHA256" /usr/local/lib/docker/cli-plugins/docker-compose
chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose

cat > /etc/systemd/system/docker.service <<'EOF'
[Unit]
Description=Docker Application Container Engine
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/dockerd
ExecReload=/bin/kill -s HUP $MAINPID
LimitNOFILE=1048576
TasksMax=infinity
TimeoutStartSec=0
Restart=on-failure
StartLimitBurst=3
StartLimitIntervalSec=60

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now docker
attempt=0
while ! docker info >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ] || { [ "$attempt" -gt 2 ] && ! systemctl is-active --quiet docker; }; then
    journalctl -u docker --no-pager -n 60 >&2 || true
    echo 'Docker daemon did not become ready' >&2
    exit 1
  fi
  sleep 1
done
node --version | grep -qx "v${NODE_VERSION}"
docker version --format '{{.Server.Version}}' | grep -qx "$DOCKER_VERSION"
docker compose version --short | grep -qx "$COMPOSE_VERSION"

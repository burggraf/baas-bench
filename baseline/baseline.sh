#!/bin/sh
set -eu
umask 077
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE=/Users/markb/dev/baas-bench/.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node
exec "$NODE" "$ROOT/baseline/prepare.mjs" "$@"

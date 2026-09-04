#!/bin/sh
set -eu
export BAAS_DB_MODE=rust-wasm
export BAAS_DB_PLATFORM=trailbase
exec "$(dirname "$0")/../../../../../shared/case.sh" run trailbase item

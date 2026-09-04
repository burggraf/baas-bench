#!/bin/sh
set -eu
export BAAS_DB_MODE=go-extension
export BAAS_DB_PLATFORM=pocketbase
exec "$(dirname "$0")/../../../../../shared/case.sh" reset pocketbase item

#!/bin/sh
set -eu
export BAAS_DB_MODE=direct
export BAAS_DB_PLATFORM=neon
exec "$(dirname "$0")/../../../../../shared/case.sh" teardown neon list

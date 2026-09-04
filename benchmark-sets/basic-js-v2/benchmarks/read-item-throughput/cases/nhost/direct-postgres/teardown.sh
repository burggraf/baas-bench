#!/bin/sh
set -eu
export BAAS_DB_MODE=direct
export BAAS_DB_PLATFORM=nhost
exec "$(dirname "$0")/../../../../../shared/case.sh" teardown nhost   item

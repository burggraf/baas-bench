#!/bin/sh
set -eu
export BAAS_DB_MODE=direct
export BAAS_DB_PLATFORM=directus
exec "$(dirname "$0")/../../../../../shared/case.sh" reset directus   list

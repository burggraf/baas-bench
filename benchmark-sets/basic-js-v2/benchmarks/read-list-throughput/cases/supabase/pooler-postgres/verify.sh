#!/bin/sh
set -eu
export BAAS_DB_MODE=pooler
export BAAS_DB_PLATFORM=supabase
exec "$(dirname "$0")/../../../../../shared/case.sh" verify supabase   list

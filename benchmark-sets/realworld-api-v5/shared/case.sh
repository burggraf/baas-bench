#!/bin/sh
set -eu
# No V4 runtime reuse or native resource mutation while V5 is unqualified.
case "${1:-}:${2:-}" in
  setup:supabase|verify:supabase|reset:supabase|run:supabase|teardown:supabase|setup:trailbase|verify:trailbase|reset:trailbase|run:trailbase|teardown:trailbase)
    echo 'V5 is not admitted: native integration, full reset, restart persistence and measurement qualification are pending' >&2
    exit 1
    ;;
  *) echo 'invalid V5 lifecycle operation' >&2; exit 2 ;;
esac

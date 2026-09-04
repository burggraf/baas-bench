#!/bin/sh
set -eu
exec "$(dirname "$0")/../../../../../shared/case.sh" run appwrite item

#!/usr/bin/env bash
# Rebuilds a throwaway database, applies every migration + the demo seed, then
# runs both suites. Exit code 0 means the isolation model holds.
#
#   ./run.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="${VGANTT_TEST_DB:-vgantt_test}"

echo "### rebuilding $DB"
VGANTT_DB="$DB" "$HERE/../migrate.sh" --reset --demo >/dev/null

echo "### tenant isolation (as vgantt_api)"
PGPASSWORD="${VGANTT_DB_APP_PASSWORD:-vgantt_app_dev_pw}" \
  psql -h "${PGHOST:-127.0.0.1}" -U vgantt_api -d "$DB" \
       -v ON_ERROR_STOP=1 -q -f "$HERE/isolation_test.sql" 2>&1 | sed 's/^psql:[^ ]* //'

echo "### vault guard + alert ladder (as superuser)"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/guard_and_alerts_test.sql" 2>&1 | sed 's/^psql:[^ ]* //'

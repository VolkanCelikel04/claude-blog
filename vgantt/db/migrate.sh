#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Applies every migration in order, then optionally the seed files.
#
#   ./migrate.sh                      # migrations only, DB = vgantt
#   ./migrate.sh --seed               # + reference data
#   ./migrate.sh --seed --demo        # + demo tenants
#   VGANTT_DB=vgantt_test ./migrate.sh --reset --seed --demo
#
# Must run as a superuser connection (roles + event triggers are created here).
# -----------------------------------------------------------------------------
set -euo pipefail

DB="${VGANTT_DB:-vgantt}"
PSQL_BASE=(psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WITH_SEED=0; WITH_DEMO=0; RESET=0
for arg in "$@"; do
  case "$arg" in
    --seed)  WITH_SEED=1 ;;
    --demo)  WITH_SEED=1; WITH_DEMO=1 ;;
    --reset) RESET=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

if [[ "$RESET" == 1 ]]; then
  echo ">> dropping database $DB"
  "${PSQL_BASE[@]}" -d postgres -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE)"
fi

if ! "${PSQL_BASE[@]}" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname = '${DB}'" | grep -q 1; then
  echo ">> creating database $DB"
  "${PSQL_BASE[@]}" -d postgres -c "CREATE DATABASE ${DB} ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0"
fi

for f in "$HERE"/migrations/*.sql; do
  version="$(basename "$f" .sql)"
  applied="$("${PSQL_BASE[@]}" -d "$DB" -tAc \
      "SELECT 1 FROM platform.schema_migrations WHERE version = '${version}'" 2>/dev/null || true)"
  if [[ "$applied" == "1" ]]; then
    echo "   skip  $version (already applied)"
    continue
  fi
  echo ">> apply $version"
  "${PSQL_BASE[@]}" -d "$DB" -f "$f"
done

if [[ "$WITH_SEED" == 1 ]]; then
  echo ">> seed  reference data"
  "${PSQL_BASE[@]}" -d "$DB" -f "$HERE/seeds/0100_reference.sql"
fi
if [[ "$WITH_DEMO" == 1 ]]; then
  echo ">> seed  demo tenants"
  "${PSQL_BASE[@]}" -d "$DB" -f "$HERE/seeds/0101_demo.sql"
fi

echo ">> done. applied migrations:"
"${PSQL_BASE[@]}" -d "$DB" -c "SELECT version, applied_at FROM platform.schema_migrations ORDER BY version"

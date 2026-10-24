# Shared by the ops scripts. Run them on the server, from the repository
# folder that holds docker-compose.yml and .env. With SELAH_LOCAL=1 they use
# the psql, pg_dump and node on this machine instead of the containers
# (PGHOST, PGUSER, PGPASSWORD and the S3_* settings then come from the
# environment); that is how they are tested without Docker.
set -eu
umask 077
ROOT="${SELAH_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DB="${SELAH_DB:-selah}"
export PGOPTIONS="-c client_min_messages=warning"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT/backups}"

say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { say "error: $*"; exit 1; }

compose() { docker compose --project-directory "$ROOT" "$@"; }

# Postgres tools as the superuser, inside the db container (or here).
pgx() {
  if [ -n "${SELAH_LOCAL:-}" ]; then "$@"; else compose exec -T -e PGOPTIONS db "$@"; fi
}
psql_q() { pgx psql -U postgres -v ON_ERROR_STOP=1 -qAtX "$@"; }

# The web app's tools image (node, tsx, the S3 client) with a folder mounted at /backup.
tools() {
  dir="$1"; shift
  if [ -n "${SELAH_LOCAL:-}" ]; then
    (cd "$ROOT/apps/web" && npm run --silent "$@" -- "$dir")
  else
    compose run --rm -T --no-deps -v "$dir:/backup" jobs npm run --silent "$@" -- /backup
  fi
}

# Exact row counts of every table in the public schema, as "table<TAB>count".
row_counts() {
  db="$1"
  psql_q -d "$db" -c "SELECT string_agg(format('SELECT %L, count(*) FROM public.%I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" |
    psql_q -d "$db" -F "$(printf '\t')" | sort
}

# A fresh, empty database with the same database-level rights as
# db/init/01-roles.sh gives (pg_dump doesn't carry those). Drops it first.
fresh_db() {
  psql_q -d postgres -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" -c "CREATE DATABASE \"$1\"" \
    -c "REVOKE ALL ON DATABASE \"$1\" FROM PUBLIC" \
    -c "GRANT CONNECT ON DATABASE \"$1\" TO selah_owner, selah_app, selah_auth" \
    -c "GRANT CREATE ON DATABASE \"$1\" TO selah_owner"
}

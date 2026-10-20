#!/bin/sh
# Runs once, as the Postgres superuser, when the database volume is first
# created (docker-entrypoint-initdb.d). Creates the three Selah roles, a
# disposable selah_test database for integration tests, and the extensions.
# Passwords come from the environment, never from Git.
set -eu

: "${SELAH_OWNER_PASSWORD:?set SELAH_OWNER_PASSWORD}"
: "${SELAH_APP_PASSWORD:?set SELAH_APP_PASSWORD}"
: "${SELAH_AUTH_PASSWORD:?set SELAH_AUTH_PASSWORD}"
DB="${POSTGRES_DB:-selah}"
TEST_DB="${SELAH_TEST_DB:-selah_test}"
PSQL="psql -v ON_ERROR_STOP=1 --username ${POSTGRES_USER:-postgres}"

$PSQL --dbname "$DB" -v owner_pw="$SELAH_OWNER_PASSWORD" -v app_pw="$SELAH_APP_PASSWORD" -v auth_pw="$SELAH_AUTH_PASSWORD" <<'SQL'
-- Owns the schema and runs migrations. Not used at runtime.
CREATE ROLE selah_owner LOGIN PASSWORD :'owner_pw';
-- Runtime roles: no BYPASSRLS, no ownership, so every policy applies.
CREATE ROLE selah_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE selah_auth LOGIN PASSWORD :'auth_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SQL

if [ "$TEST_DB" != "$DB" ]; then
  $PSQL --dbname "$DB" -c "CREATE DATABASE \"$TEST_DB\""
fi

for d in "$DB" "$TEST_DB"; do
  $PSQL --dbname "$d" -v db="$d" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO selah_owner, selah_app, selah_auth;
-- The migrator keeps its journal in its own schema.
GRANT CREATE ON DATABASE :"db" TO selah_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO selah_owner;
SQL
done

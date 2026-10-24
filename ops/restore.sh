#!/bin/sh
# Restore Selah from a backup (R3). This replaces the live database.
#
#   ops/restore.sh BACKUP_ROOT/<time> --yes
#   ops/restore.sh <time>.tar.age --yes      (needs BACKUP_AGE_IDENTITY)
#
# 1. Runs the restore drill on the backup first and stops if it fails.
# 2. Stops the web app, the jobs and the mail sender.
# 3. Keeps a dump of the current database in $BACKUP_ROOT/pre-restore-<time>.dump.
# 4. Replaces the database with the backup's.
# 5. Puts back any stored file the bucket is missing (never overwrites).
# 6. Starts everything again.
# On a new server: install, fill .env (same passwords for the roles),
# `docker compose up -d db storage`, `docker compose run --rm setup`, then this.
. "$(dirname "$0")/lib.sh"

src="${1:?usage: ops/restore.sh <backup folder or .tar.age> --yes}"
[ "${2:-}" = "--yes" ] || die "this replaces the live database; add --yes"

"$ROOT/ops/restore-drill.sh" "$src" || die "the drill failed on this backup; nothing was changed"

tmp=""
trap '[ -z "$tmp" ] || rm -rf "$tmp"' EXIT
case "$src" in
  *.tar.age)
    tmp=$(mktemp -d)
    age -d -i "$BACKUP_AGE_IDENTITY" "$src" | tar -C "$tmp" -xf -
    run="$tmp/$(basename "$src" .tar.age)"; objects="$tmp/objects" ;;
  *) run="$src"; objects="$(dirname "$src")/objects" ;;
esac

[ -n "${SELAH_LOCAL:-}" ] || compose stop web jobs mail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
say "restore: keeping the current database in pre-restore-$stamp.dump"
pgx pg_dump -U postgres -Fc "$DB" > "$BACKUP_ROOT/pre-restore-$stamp.dump"

say "restore: replacing database $DB"
fresh_db "$DB"
pgx pg_restore -U postgres --exit-on-error -d "$DB" < "$run/db.dump"

say "restore: stored files"
cp "$run/objects.tsv" "$objects/objects.tsv"
tools "$objects" restore:storage

[ -n "${SELAH_LOCAL:-}" ] || compose up -d web jobs mail
say "restore: done from $(basename "$run"); sign in and check the site"

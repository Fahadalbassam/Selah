#!/bin/sh
# Back up Selah (R3): the database and every stored file.
#
#   ops/backup.sh                 a backup in $BACKUP_ROOT (default ./backups)
#   ops/backup.sh --offsite DIR   the same, plus an encrypted copy in DIR
#
# Each run makes $BACKUP_ROOT/<UTC time>/ with
#   db.dump        pg_dump of the database (custom format)
#   globals.sql    the roles, without passwords (they come from .env)
#   objects.tsv    every stored file: key, size, sha256
#   counts.tsv     exact row counts per table, for the restore drill
#   manifest.txt   when, which commit, migrations applied, the audit chain's head
#   SHA256SUMS     checksums of the files above
# Stored files are kept once, in $BACKUP_ROOT/objects/ (their keys never
# change), and listed per backup in objects.tsv.
#
# --offsite writes <time>.tar.age: the backup folder and the files it lists,
# encrypted with age to $BACKUP_AGE_RECIPIENT (a public key; the private key
# is kept off the server). Copy that file to the second location.
#
# Old backups go after $BACKUP_KEEP_DAYS days (default 30, the period the
# data processing agreement promises for erasure to reach the backups), and
# so do encrypted copies in the --offsite folder. $BACKUP_KEEP_MONTHLY_DAYS
# (default 0, off) keeps the first backup of each month longer; only set it
# if the firm's agreements allow. A stored file is removed from objects/ once
# no kept backup lists it.
. "$(dirname "$0")/lib.sh"

offsite=""
[ "${1:-}" = "--offsite" ] && { offsite="${2:?--offsite needs a folder}"; [ -d "$offsite" ] || die "no folder $offsite"; }
[ -z "$offsite" ] || [ -n "${BACKUP_AGE_RECIPIENT:-}" ] || die "set BACKUP_AGE_RECIPIENT for --offsite"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_ROOT/objects"
chmod 700 "$BACKUP_ROOT"
run="$BACKUP_ROOT/$stamp"
work="$run.partial"
mkdir "$work"
trap 'rm -rf "$work"' EXIT

say "backup $stamp: database"
pgx pg_dump -U postgres -Fc "$DB" > "$work/db.dump"
pgx pg_dumpall -U postgres --globals-only --no-role-passwords > "$work/globals.sql"
row_counts "$DB" > "$work/counts.tsv"

say "backup $stamp: stored files"
tools "$BACKUP_ROOT/objects" backup:storage
cp "$BACKUP_ROOT/objects/objects.tsv" "$work/objects.tsv"

{
  echo "time: $stamp"
  echo "commit: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "migrations: $(psql_q -d "$DB" -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
  echo "audit head: $(psql_q -d "$DB" -c "SELECT coalesce(head_seq, 0) || ' ' || coalesce(head_hash, '-') FROM audit_chain")"
  echo "files: $(wc -l < "$work/objects.tsv" | tr -d ' ')"
} > "$work/manifest.txt"
(cd "$work" && sha256sum db.dump globals.sql objects.tsv counts.tsv manifest.txt > SHA256SUMS)
mv "$work" "$run"
trap - EXIT
say "backup $stamp: done, $(du -sh "$run/db.dump" | cut -f1) database"

if [ -n "$offsite" ]; then
  say "backup $stamp: encrypted copy"
  cut -f1 "$run/objects.tsv" | sed 's|^|objects/|' > "$run.files"
  printf '%s\n' "$stamp" >> "$run.files"
  tar -C "$BACKUP_ROOT" -cf - -T "$run.files" | age -r "$BACKUP_AGE_RECIPIENT" > "$offsite/$stamp.tar.age.part"
  mv "$offsite/$stamp.tar.age.part" "$offsite/$stamp.tar.age"
  rm -f "$run.files"
  say "backup $stamp: $offsite/$stamp.tar.age"
fi

# Retention: daily backups, then monthly ones, then the files nothing lists.
keep_days="${BACKUP_KEEP_DAYS:-30}"
keep_monthly="${BACKUP_KEEP_MONTHLY_DAYS:-0}"
now=$(date -u +%s)
seen_months=" "
for d in $(ls -1 "$BACKUP_ROOT" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort); do
  t=$(date -u -d "$(echo "$d" | sed -E 's/(....)(..)(..)T(..)(..)(..)Z/\1-\2-\3 \4:\5:\6/')" +%s)
  age_days=$(( (now - t) / 86400 ))
  month=$(echo "$d" | cut -c1-6)
  first=no
  case "$seen_months" in *" $month "*) ;; *) first=yes; seen_months="$seen_months$month " ;; esac
  if [ "$age_days" -gt "$keep_days" ] && { [ "$first" = no ] || [ "$age_days" -gt "$keep_monthly" ]; }; then
    say "retention: removing backup $d ($age_days days)"
    rm -rf "${BACKUP_ROOT:?}/$d"
  fi
done
if [ -n "$offsite" ]; then
  find "$offsite" -maxdepth 1 -name '*Z.tar.age' -mtime +"$keep_days" | while IFS= read -r f; do
    say "retention: removing encrypted copy $(basename "$f")"
    rm -f "$f"
  done
fi
find "$BACKUP_ROOT" -maxdepth 1 -name 'pre-restore-*.dump' -mtime +"$keep_days" -exec rm -f {} +
listed=$(mktemp)
cat "$BACKUP_ROOT"/*/objects.tsv 2>/dev/null | cut -f1 | sort -u > "$listed"
(cd "$BACKUP_ROOT/objects" && find . -type f ! -name objects.tsv ! -name '*.part' | sed 's|^\./||' | sort) |
  comm -23 - "$listed" | while IFS= read -r k; do
    say "retention: removing stored file no backup lists"
    rm -f "$BACKUP_ROOT/objects/$k"
  done
rm -f "$listed"

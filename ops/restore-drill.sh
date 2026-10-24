#!/bin/sh
# Prove a backup can be restored (R3), without touching the live site.
#
#   ops/restore-drill.sh                     the newest backup in $BACKUP_ROOT
#   ops/restore-drill.sh BACKUP_ROOT/<time>  a given backup
#   ops/restore-drill.sh <time>.tar.age      an encrypted copy (needs
#                                            BACKUP_AGE_IDENTITY, the private key file)
#
# Checks, in order: the backup's checksums; the database restores into a
# scratch database (selah_drill); every table has the row count it had when
# backed up; the audit chain verifies from end to end; every file the
# restored database points to is in the backup with the right sha256. Then
# the scratch database is dropped. The result and the time it took are
# appended to $BACKUP_ROOT/drill-log.tsv. Exits non-zero if any check fails.
. "$(dirname "$0")/lib.sh"

DRILL_DB="${SELAH_DRILL_DB:-selah_drill}"
[ "$DRILL_DB" != "$DB" ] || die "the drill database can't be the live one"
started=$(date -u +%s)
src="${1:-}"
tmp=""
cleanup() {
  psql_q -d postgres -c "DROP DATABASE IF EXISTS \"$DRILL_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  [ -z "$tmp" ] || rm -rf "$tmp"
}
trap cleanup EXIT

if [ -z "$src" ]; then
  src=$(ls -1d "$BACKUP_ROOT"/*Z 2>/dev/null | grep -E '/[0-9]{8}T[0-9]{6}Z$' | sort | tail -1)
  [ -n "$src" ] || die "no backup in $BACKUP_ROOT"
fi
case "$src" in
  *.tar.age)
    [ -n "${BACKUP_AGE_IDENTITY:-}" ] || die "set BACKUP_AGE_IDENTITY to decrypt $src"
    tmp=$(mktemp -d)
    say "drill: decrypting $(basename "$src")"
    age -d -i "$BACKUP_AGE_IDENTITY" "$src" | tar -C "$tmp" -xf -
    run="$tmp/$(basename "$src" .tar.age)"
    objects="$tmp/objects"
    ;;
  *)
    run="$src"
    objects="$(dirname "$src")/objects"
    ;;
esac
name=$(basename "$run")
fail() {
  say "drill $name: FAILED: $*"
  printf '%s\t%s\tfailed\t%s\t%s\n' "$(date -u +%FT%TZ)" "$name" "$(( $(date -u +%s) - started ))" "$*" >> "$BACKUP_ROOT/drill-log.tsv"
  exit 1
}

say "drill $name: checksums"
(cd "$run" && sha256sum -c --quiet SHA256SUMS) || fail "checksums don't match"

say "drill $name: restoring into $DRILL_DB"
fresh_db "$DRILL_DB"
pgx pg_restore -U postgres --exit-on-error -d "$DRILL_DB" < "$run/db.dump" || fail "pg_restore failed"

say "drill $name: row counts"
counts_file=$(mktemp)
row_counts "$DRILL_DB" > "$counts_file"
if ! cmp -s "$counts_file" "$run/counts.tsv"; then
  diff "$run/counts.tsv" "$counts_file" >&2 || true
  rm -f "$counts_file"
  fail "row counts differ"
fi
rows=$(awk -F '\t' '{ n += $2 } END { print n + 0 }' "$counts_file")
rm -f "$counts_file"

say "drill $name: audit chain"
chain=$(psql_q -d "$DRILL_DB" -c "SELECT ok || ' ' || rows_checked || ' ' || coalesce(first_bad_seq::text, '-') FROM app_check_audit_chain()")
case "$chain" in true*) ;; *) fail "audit chain broken: $chain" ;; esac

say "drill $name: stored files"
missing=$(psql_q -d "$DRILL_DB" -F "$(printf '\t')" -c "SELECT storage_key, sha256 FROM documents ORDER BY 1" | while IFS="$(printf '\t')" read -r key hash; do
  if [ ! -f "$objects/$key" ] || [ "$(sha256sum "$objects/$key" | cut -d' ' -f1)" != "$hash" ]; then echo "$key"; fi
done | wc -l | tr -d ' ')
[ "$missing" = 0 ] || fail "$missing stored files missing or changed"
files=$(psql_q -d "$DRILL_DB" -c "SELECT count(*) FROM documents")

took=$(( $(date -u +%s) - started ))
printf '%s\t%s\tok\t%s\t%s rows, %s files, chain %s\n' "$(date -u +%FT%TZ)" "$name" "$took" "$rows" "$files" "$chain" >> "$BACKUP_ROOT/drill-log.tsv"
say "drill $name: OK in ${took}s ($rows rows, $files files)"

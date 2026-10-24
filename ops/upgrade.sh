#!/bin/sh
# Upgrade Selah to a newer version (R4), with a way back.
#
#   ops/upgrade.sh [REF]       upgrade to REF (a tag or commit; default origin/main)
#   ops/upgrade.sh --rollback  go back to the version and data from before the
#                              last upgrade
#
# An upgrade: refuses local changes; shows what is coming; takes a backup
# (ops/backup.sh) and notes it with the current commit in
# $BACKUP_ROOT/last-upgrade; checks out REF; rebuilds; runs the migrations
# (the setup service); starts everything; and waits up to five minutes for
# ops/readiness.sh's web check to pass. If it doesn't, it says how to roll back.
#
# Migrations only go forward, so going back restores the database from the
# backup taken before the upgrade: work done since then is lost. Roll back
# soon, or not at all.
# A checkout changes this very file while it runs, so it runs from a copy.
if [ -z "${SELAH_ROOT:-}" ]; then
  SELAH_ROOT=$(cd "$(dirname "$0")/.." && pwd); export SELAH_ROOT
  copy=$(mktemp); cp "$0" "$copy"; cp "$SELAH_ROOT/ops/lib.sh" "$copy.lib"
  exec sh "$copy" "$@"
fi
. "$0.lib"
trap 'rm -f "$0" "$0.lib"' EXIT
cd "$ROOT"
note="$BACKUP_ROOT/last-upgrade"

wait_ready() {
  i=0
  until curl -fsS -m 10 "${OPS_READY_URL:-http://127.0.0.1:3000/api/ready}" >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -lt 30 ] || return 1; sleep 10
  done
}

if [ "${1:-}" = "--rollback" ]; then
  [ -f "$note" ] || die "no upgrade to roll back ($note is missing)"
  prev=$(sed -n 's/^commit: //p' "$note"); backup=$(sed -n 's/^backup: //p' "$note")
  [ -n "$prev" ] && [ -d "$BACKUP_ROOT/$backup" ] || die "the note or its backup is missing: $note"
  say "rollback: back to $prev with backup $backup"
  git -c advice.detachedHead=false checkout -q "$prev"
  compose build
  "$ROOT/ops/restore.sh" "$BACKUP_ROOT/$backup" --yes
  compose up -d
  wait_ready || die "the site isn't ready after the rollback; see ops/readiness.sh"
  rm -f "$note"
  say "rollback: done, on $(git rev-parse --short HEAD)"
  exit 0
fi

[ -z "$(git status --porcelain --untracked-files=no)" ] || die "the checkout has local changes; commit or remove them first"
git fetch -q --tags origin
target="${1:-origin/main}"
git rev-parse -q --verify "$target^{commit}" >/dev/null || die "unknown version: $target"
from=$(git rev-parse --short HEAD); to=$(git rev-parse --short "$target^{commit}")
[ "$from" != "$to" ] || { say "already on $to"; exit 0; }
say "upgrade: $from -> $to"
git log --oneline "HEAD..$target" | head -30 >&2

"$ROOT/ops/backup.sh"
backup=$(ls -1 "$BACKUP_ROOT" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -1)
printf 'commit: %s\nbackup: %s\ntarget: %s\ntime: %s\n' "$(git rev-parse HEAD)" "$backup" "$to" "$(date -u +%FT%TZ)" > "$note"

git -c advice.detachedHead=false checkout -q "$target"
compose build
compose run --rm setup
compose up -d
if wait_ready; then
  say "upgrade: done, on $to. Backup $backup is kept for a rollback (ops/upgrade.sh --rollback)."
else
  say "upgrade: the site isn't ready after five minutes. Look at ops/readiness.sh and 'docker compose logs web';"
  say "to go back to $from with the data from before the upgrade: ops/upgrade.sh --rollback"
  exit 1
fi

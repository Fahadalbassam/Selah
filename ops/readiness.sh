#!/bin/sh
# Is the server ready (R4)? One look at everything, for an operator or from
# cron:
#
#   ops/readiness.sh           prints each check, exits 1 if any fails
#   ops/readiness.sh --alert   the same, and posts the failures to
#                              OPS_ALERT_WEBHOOK (for the case where the jobs
#                              container, which alerts otherwise, is down)
#
# Checks: the web app's readiness probe (each dependency, with OPS_TOKEN from
# .env), the containers, the newest backup (under 26 hours), the newest
# restore drill (passed, under 35 days) and free disk space (under 90% used).
. "$(dirname "$0")/lib.sh"

[ -f "$ROOT/.env" ] && OPS_TOKEN="${OPS_TOKEN:-$(sed -n 's/^OPS_TOKEN=//p' "$ROOT/.env" | tr -d '"')}"
READY_URL="${OPS_READY_URL:-http://127.0.0.1:3000/api/ready}"
failed=""
line() { printf '%-14s %-5s %s\n' "$1" "$2" "$3"; [ "$2" = ok ] || failed="$failed\n$1: $3"; }

# The web app and what it depends on.
ready=$(curl -sS -m 15 ${OPS_TOKEN:+-H "Authorization: Bearer $OPS_TOKEN"} "$READY_URL" 2>&1) || ready=""
case "$ready" in
  *'"status":"ok"'*) line "web app" ok "$READY_URL" ;;
  *'"status"'*) line "web app" fail "$(echo "$ready" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')" ;;
  *) line "web app" fail "no answer from $READY_URL" ;;
esac
echo "$ready" | tr '{' '\n' | grep '"name":' | while IFS= read -r c; do
  name=$(echo "$c" | sed 's/.*"name":"\([^"]*\)".*/\1/')
  case "$c" in
    *'"ok":true'*) printf '  %-12s ok\n' "$name" ;;
    *) printf '  %-12s fail  %s\n' "$name" "$(echo "$c" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')" ;;
  esac
done

# Long-running containers.
if [ -z "${SELAH_LOCAL:-}" ]; then
  for svc in db storage clamav pdf ollama ai web mail jobs; do
    state=$(compose ps --format '{{.State}} {{.Health}}' "$svc" 2>/dev/null | head -1)
    case "$state" in
      "running healthy"|"running ") line "$svc" ok "running" ;;
      "running starting") line "$svc" ok "starting" ;;
      "") line "$svc" fail "not running" ;;
      *) line "$svc" fail "$state" ;;
    esac
  done
fi

# Backups and the drill.
newest=$(ls -1 "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -1)
if [ -z "$newest" ]; then line backup fail "none in $BACKUP_ROOT"
else
  t=$(date -u -d "$(echo "$newest" | sed -E 's/(....)(..)(..)T(..)(..)(..)Z/\1-\2-\3 \4:\5:\6/')" +%s)
  h=$(( ($(date -u +%s) - t) / 3600 ))
  [ "$h" -lt 26 ] && line backup ok "$newest ($h h ago)" || line backup fail "newest is $newest, $h hours old"
fi
drill=$(tail -1 "$BACKUP_ROOT/drill-log.tsv" 2>/dev/null || true)
if [ -z "$drill" ]; then line drill fail "never run (ops/restore-drill.sh)"
else
  d=$(( ($(date -u +%s) - $(date -u -d "$(echo "$drill" | cut -f1)" +%s)) / 86400 ))
  case "$(echo "$drill" | cut -f3)" in
    ok) [ "$d" -le 35 ] && line drill ok "$(echo "$drill" | cut -f2) passed $d days ago" || line drill fail "last passed $d days ago" ;;
    *) line drill fail "last drill failed: $(echo "$drill" | cut -f5)" ;;
  esac
fi

# Disk space where the data and the backups live.
docker_root=$( [ -n "${SELAH_LOCAL:-}" ] || docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
for dir in "$BACKUP_ROOT" $docker_root; do
  [ -d "$dir" ] || continue
  used=$(df -P "$dir" | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
  [ "$used" -lt 90 ] && line disk ok "$dir $used% used" || line disk fail "$dir $used% used"
done

[ -z "$failed" ] && exit 0
if [ "${1:-}" = "--alert" ] && [ -n "${OPS_ALERT_WEBHOOK:-}" ]; then
  text=$(printf 'Selah readiness on %s: failing\\n%s' "$(hostname)" "$failed" | sed 's/"/\\"/g')
  curl -sS -m 15 -H 'content-type: application/json' -d "{\"text\":\"$text\"}" "$OPS_ALERT_WEBHOOK" >/dev/null || say "the alert webhook failed"
fi
exit 1

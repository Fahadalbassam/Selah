#!/bin/sh
# The scheduled jobs, for a single-machine install (docker compose service
# "jobs"). Every few minutes: indexes new files for the assistant, removes the
# bytes of deleted files, seals new audit-log entries and checks that
# everything is up, alerting the administrators when not (job:ops-check).
# Once a day (Riyadh date): keeps each project's weekly health signal and
# alerts on quiet clients (job:health, before the reminders so the alert
# rides the same summary mail), sends follow-up reminders, checks the audit chain
# and runs the retention purges. On the 1st of each month: takes the metrics
# snapshot. A failing job is logged and retried on the next round; it never
# stops the others.
set -u
INDEX_EVERY="${INDEX_EVERY_SECONDS:-120}"
last_day=""
last_month=""
run() { npm run --silent "$1" || echo "jobs: $1 failed, retrying next round" >&2; }
while :; do
  run job:index-documents
  run job:delete-objects
  run job:audit-seal
  run job:ops-check
  day=$(TZ=Asia/Riyadh date +%F)
  if [ "$day" != "$last_day" ]; then
    for j in job:health job:follow-ups job:audit-check job:purge-chats job:purge-clients job:purge-inquiries job:purge-minimal job:purge-transcripts; do run "$j"; done
    last_day="$day"
  fi
  month=$(TZ=Asia/Riyadh date +%Y-%m)
  if [ "$(TZ=Asia/Riyadh date +%d)" = "01" ] && [ "$month" != "$last_month" ]; then
    run job:metrics
    last_month="$month"
  fi
  sleep "$INDEX_EVERY"
done

#!/bin/sh
# The scheduled jobs, for a single-machine install (docker compose service
# "jobs"). Indexes new files for the assistant every few minutes; once a day
# (Riyadh date) sends follow-up reminders and runs the retention purges; on
# the 1st of each month takes the metrics snapshot. A failing job is logged
# and retried on the next round; it never stops the others.
set -u
INDEX_EVERY="${INDEX_EVERY_SECONDS:-120}"
last_day=""
last_month=""
run() { npm run --silent "$1" || echo "jobs: $1 failed, retrying next round" >&2; }
while :; do
  run job:index-documents
  day=$(TZ=Asia/Riyadh date +%F)
  if [ "$day" != "$last_day" ]; then
    for j in job:follow-ups job:purge-chats job:purge-inquiries job:purge-minimal job:purge-transcripts; do run "$j"; done
    last_day="$day"
  fi
  month=$(TZ=Asia/Riyadh date +%Y-%m)
  if [ "$(TZ=Asia/Riyadh date +%d)" = "01" ] && [ "$month" != "$last_month" ]; then
    run job:metrics
    last_month="$month"
  fi
  sleep "$INDEX_EVERY"
done

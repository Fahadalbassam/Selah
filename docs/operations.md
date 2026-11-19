# Operations

Running Selah on the firm's server: backups, restoring, knowing it is up, upgrading, and what to do when something goes wrong (readiness items R3, R4 and R5). Everything here runs on the server, from the repository folder that holds `docker-compose.yml` and `.env`.

## How traffic reaches it

One setting in `.env` chooses the way in, and both ways put the same Caddy (`ops/edge/Caddyfile`) in front of the web app, so headers and limits don't change when switching.

| `COMPOSE_PROFILES` | What runs | Who sees the traffic | Open ports |
| --- | --- | --- | --- |
| *(empty)* | Nothing in front; the app on `127.0.0.1:3000` | Only this machine | None |
| `tunnel` | `cloudflared` and `edge-tunnel` | Cloudflare ends HTTPS and sees the traffic (listed as a sub-processor) | None; the server opens the connection |
| `direct` | `edge`, with its own certificates (Let's Encrypt, renewed by Caddy) | Nobody outside the server | 80 and 443 |

Both serve two names: `SITE_DOMAIN` (the site) and `FILES_DOMAIN` (the one-minute signed download links; only `GET` and `HEAD` pass, uploads always go through the app). Set `APP_URL=https://SITE_DOMAIN` and `S3_PUBLIC_ENDPOINT=https://FILES_DOMAIN`.

The visitor's address, which the sign-in and inquiry limits use, is always set by Caddy and never taken from the visitor: in direct mode it is the connection's address, in tunnel mode Cloudflare's `Cf-Connecting-Ip` (trusted only because nothing but `cloudflared` can reach `edge-tunnel`). Whatever the visitor sends in `X-Forwarded-For` is replaced.

**Tunnel** (the current setup, synthetic data only). Create a tunnel in the Cloudflare dashboard (Zero Trust, Networks, Tunnels), copy its token into `CLOUDFLARE_TUNNEL_TOKEN`, and add two public hostnames, `SITE_DOMAIN` and `FILES_DOMAIN`, both to `http://edge-tunnel:80`. Then `COMPOSE_PROFILES=tunnel` and `docker compose up -d`.

**Switching to direct** (before any real client file).
1. Point `SITE_DOMAIN` and `FILES_DOMAIN` at the server's public address (DNS A records, not proxied through Cloudflare), and open ports 80 and 443 to it.
2. In `.env`: `COMPOSE_PROFILES=direct`, and remove `CLOUDFLARE_TUNNEL_TOKEN`.
3. `docker compose up -d --remove-orphans`. Caddy gets the certificates on the first request; `docker compose logs edge` shows it.
4. Delete the tunnel in the Cloudflare dashboard, and check that the sub-processor page now shows Cloudflare as not in use.

The sub-processor list and the security overview (`/legal/sub-processors`, `/legal/security`) read the same setting, so what clients are told follows what runs.

The list's mail row follows the mail relay in the same way. The web app reads `SMTP_URL` when it has it (a development copy, and the end-to-end stack in `docker-compose.test.yml`, which points at the local mailbox); it sends no mail and reads only the relay's host (`mailRelay()` in `src/lib/legal.ts`). `docker-compose.yml` does not give the production web app `SMTP_URL`, so the relay's password stays with the mail sender alone. A relay on the internet marks the mail service "in use on this site". A mailbox on this machine or on the server's own network (`localhost`, a container name such as `mailpit`, a private address) does not, and neither does a development copy with no relay. When the app cannot tell (a production copy that was not given `SMTP_URL`), it says "in use" rather than deny it.

## Security overview for clients' IT teams

`/legal/security`, in Arabic and English, is the security pack to send a client's IT or security team: where Selah runs, how traffic reaches it, how clients are kept apart, sign-in, files, the AI assistant, audit and monitoring, backups, incidents and how it is built, with a panel showing this site's actual setup (way in, where the model runs, scanning, two-factor). It links to the sub-processor list and the data processing agreement template. Keep it true: when a control changes, change its text in `messages/*.json` in the same pull request. For a detailed review, `docs/security.md` maps the controls to OWASP ASVS 5.0 and the OWASP Top 10 for LLM applications.

## Backups

`ops/backup.sh` backs up the database and every stored file.

- **What a backup holds.** Each run makes `backups/<UTC time>/` with the database dump (`db.dump`, `pg_dump` custom format), the roles without passwords (`globals.sql`; the passwords live in `.env`), the list of stored files with their sha256 (`objects.tsv`), exact row counts per table (`counts.tsv`), a manifest (commit, migrations applied, the audit chain's latest seal) and `SHA256SUMS`. Stored files are kept once, in `backups/objects/`, because their keys never change; each backup lists the ones it needs.
- **Where.** `$BACKUP_ROOT`, by default `./backups` (ignored by Git). Put it on a different disk from the Docker volumes, so a failed disk doesn't take both. The folder is created readable by its owner only.
- **The second location.** `ops/backup.sh --offsite DIR` also writes `DIR/<time>.tar.age`: that backup and the files it lists, encrypted with [age](https://age-encryption.org) to `BACKUP_AGE_RECIPIENT`, a public key. Make the key pair on another machine (`age-keygen -o selah-backup.key`), give the server only the public line, and keep the private key file off the server with two named people. Copy each `.tar.age` to the second location in the Kingdom (another server or a disk kept elsewhere), as the privacy notice and the data processing agreement say.
- **How long.** Backups and encrypted copies in the `--offsite` folder are removed after `BACKUP_KEEP_DAYS` (30 by default), and so are stored files no kept backup still lists. That is the period the data processing agreement gives for erasure to reach the backups. If the `--offsite` folder isn't where the copies end up, the second location must remove them after the same time. `BACKUP_KEEP_MONTHLY_DAYS` keeps the first backup of each month longer; it is off by default and should stay off unless the firm's agreements allow it.
- **When.** Nightly, from the server's crontab, after the jobs' night run:

  ```
  # m h  dom mon dow  command
  30 2 * * *  cd /srv/selah && BACKUP_ROOT=/backup/selah BACKUP_AGE_RECIPIENT=age1... ops/backup.sh --offsite /mnt/second-site >> /var/log/selah-backup.log 2>&1
  0  4 1 * *  cd /srv/selah && BACKUP_ROOT=/backup/selah ops/restore-drill.sh >> /var/log/selah-backup.log 2>&1
  ```

  With one backup a night, at most a day of work is lost (the recovery point). Run it more often if the firm wants less.

## Restore drill

`ops/restore-drill.sh` proves a backup can be restored without touching the live site. It takes the newest backup (or a given folder, or an encrypted `.tar.age` copy with `BACKUP_AGE_IDENTITY` set to the private key file), then:

1. checks the backup's checksums;
2. restores the dump into a scratch database, `selah_drill`;
3. compares every table's row count with the count taken at backup time;
4. verifies the audit chain end to end (`app_check_audit_chain()`);
5. checks that every file the restored database points to is in the backup with the right sha256;
6. drops the scratch database and appends the result and the time it took to `backups/drill-log.tsv`.

It exits non-zero on any failure. Run it monthly (the crontab above), and once a quarter on an encrypted copy brought back from the second location, so the private key and the copy are both proven. The time in the log is the restore time to expect (the recovery time) at the current size.

## Restoring

`ops/restore.sh <backup folder or .tar.age> --yes` replaces the live database:

1. runs the drill on that backup first and changes nothing if it fails;
2. stops the web app, the jobs and the mail sender;
3. keeps a dump of the current database as `backups/pre-restore-<time>.dump` (removed with the old backups);
4. replaces the database with the backup's;
5. puts back any stored file the bucket is missing, after checking its sha256 (it never overwrites or deletes);
6. starts everything again.

A backup taken before the pre-go-live clean-up (Before go-live, step 2) still holds old private file names: after restoring one, stop `web jobs` and run that script again.

On a new server: install Docker, check out the same commit (the manifest names it), fill `.env` with the same role passwords, `docker compose up -d db storage`, `docker compose run --rm setup`, then `ops/restore.sh`. Work done after the backup is lost; say so to the clients affected.

Tested with `SELAH_LOCAL=1`, which runs the same scripts with the tools on the machine instead of the containers.

## Knowing it is up

**Probes.** `/api/health` answers 200 while the web app runs (liveness). `/api/ready` checks what the web app needs: the database, the bucket and the virus scanner are critical, the PDF renderer and the AI service only switch features off. It answers 200 with `{"status":"ok"}` or `"degraded"`, and 503 with `"down"` when a critical one fails. The public sees only that word; with `Authorization: Bearer $OPS_TOKEN` it lists each check with its time and error. Results are reused for 10 seconds, so the probe can't be used to load the server. An outside uptime monitor can poll `/api/ready` through the tunnel.

**Alerts.** The jobs container runs `job:ops-check` every two minutes. It reads the probe's checks (with `OPS_TOKEN`) and adds three that need the schema owner: mail that keeps failing to send (or was given up on today), the audit chain's nightly check (missing for 30 hours or failed) and sealing (entries waiting over an hour). It alerts when something starts failing, every six hours while it keeps failing, and once when everything recovers; the first round after the jobs start only takes note, so a restart doesn't page anyone. Alerts are in Arabic and English and go to `OPS_ALERT_EMAIL` straight through `SMTP_URL` (not the mail queue, which may be what is broken) and to `OPS_ALERT_WEBHOOK` if set (a POST with `{"text": ...}`, which Slack, Teams and ntfy accept).

**On the server.** `ops/readiness.sh` shows everything at once: the probe's checks, the containers, the newest backup (under 26 hours), the newest restore drill (passed, under 35 days) and disk use (under 90%) where the data and the backups live. It exits 1 if anything fails. From cron with `--alert` it also posts failures to `OPS_ALERT_WEBHOOK`, which covers the jobs container itself being down:

```
*/10 * * * *  cd /srv/selah && BACKUP_ROOT=/backup/selah OPS_ALERT_WEBHOOK=https://... ops/readiness.sh --alert > /dev/null
```

## Upgrading

`ops/upgrade.sh [REF]` moves to a newer version (a tag or commit; `origin/main` by default):

1. refuses if the checkout has local changes, and shows the commits coming;
2. takes a backup and notes it, with the current commit, in `backups/last-upgrade`;
3. checks out the new version, rebuilds the images, runs the migrations (the `setup` service) and starts everything;
4. waits up to five minutes for `/api/ready`, and if it doesn't pass, says how to go back.

`ops/upgrade.sh --rollback` goes back: the previous commit, rebuilt, with the database restored from the backup taken before the upgrade (migrations only go forward). Work done since the upgrade is lost, so roll back soon or not at all. Upgrade outside working hours, and run `ops/readiness.sh` afterwards.

**Migration 0112 (Arabic word search) rewrites the assistant's passages.** It drops the stored search column of `ai_chunks` and adds it again, computed by `app_search_tsv()` (PostgreSQL 16 cannot change a generated column's expression), then builds its GIN index again. `ALTER TABLE` holds an exclusive lock on `ai_chunks` until it is done: the assistant can neither search nor index during that time (questions wait, then fail if it lasts past their timeout; the rest of Selah works). The embeddings are not touched. Plan it in a maintenance window, as for any upgrade. Measured on the laptop (Core i7-13700H, Postgres 16 in Docker), 20,000 passages of 1,656 characters each: the column took 50 s with the new function against 7 s with the old `to_tsvector('simple', ...)`, and the index under 1 s. That is about **4 minutes per 100,000 passages** here, 2.5 ms a passage (`to_tsvector` alone: 0.34 ms; most of the rest is the Arabic fold); allow two to three times that on a slower server. Count first: `SELECT count(*) FROM ai_chunks;`. Indexing new files afterwards costs the same 2.5 ms a passage, next to seconds for the embedding.

**Migration 0114 (the number scanner) indexes every file again.** Personal numbers (IDs, Iqama numbers, IBANs, cards, phones, e-mails, passport and CR numbers) are now tagged in the assistant's passages (`docs/assistant.md`, "Personal numbers"), so 0114 sends every file that was indexed back to the indexing job (`text_status = 'pending'`) and drops the plan's record passages, which the job writes again, tagged. Until the job reaches a file, its old passages stay (with the numbers as written) and it reads "pending" in the file panel; its summary button says the file is not indexed yet. The job takes 100 files a round, and the embeddings are most of its time: allow about **3.5 hours per 10,000 files** on the server's processor (the review's estimate; count first with `SELECT count(*) FROM documents WHERE ai_indexable AND state <> 'archived';`). The job also reads every other file once, those the assistant may not read included (confidential ones too), only to count their numbers for the switch's warning: it keeps the counts, nothing of the text, and nothing leaves the server. What was made before 0114 is not rewritten: file summaries, assistant answers and translations kept before the upgrade may still hold numbers as written until they are made again (a new version of the file, a new question, a changed original). Delete them if that matters: `TRUNCATE document_summaries;` (summaries are made again on request).

## Before go-live

Do these once, on the live database, before the firm's real clients are let in.

**1. Size the engagement end reminders (migration 0109).** Also before any later upgrade that first brings 0109. The first daily run after it tells the firm about every open engagement of an active client that ends within the next 30 days or ended in the last 30. Size it on the live database first (read only):

```sql
SELECT count(*) AS engagements,
       sum(cardinality(ARRAY(SELECT app_engagement_reminder_audience(g.id)))) AS notices
FROM engagements g JOIN organizations o ON o.id = g.client_org_id AND o.status = 'active'
WHERE g.ends_on IS NOT NULL
  AND app_firm_today() BETWEEN g.ends_on - app_engagement_reminder_days() AND g.ends_on + app_engagement_reminder_days()
  AND app_engagement_open(g.id);
```

The notices go into each person's summary mail, so mails are at most one per person that day. Run it after the migration (the functions come with it) and before the next daily job, or with the functions' bodies inlined before.

**2. Clean old private file names out of the audit log and the activity record.** Before migration 0106, withdrawing a wrong upload stored the file's name in the audit log (`document.withdraw`, `meta.title`) and the file's name and the reason in the activity record (`document_withdrawn`, `meta.title` and `meta.reason`), where the other side could read them. 0106 stopped that and hides the old rows when they are read, but the stored rows still hold the names. `pre-go-live:clean-private-names` removes those fields and leaves `"redacted": true` in their place. Those old activity rows were also all stored with the label "shared", whatever the file's label; it gives each one its file's own label, as 0106 does for new rows. It never deletes a row, and rows written since 0106 are not touched.

- Run it as the schema owner, with the web app and the jobs stopped. It holds the audit log and the activity record locked while it works.
- It refuses a database that does not have migration 0106 yet (checked in the migrations journal, `drizzle.__drizzle_migrations`): until 0106, new withdrawals still write the names. Upgrade first.
- Rebuild the tools image at the commit you are running, so the `jobs` container has the script.
- By default it is a dry run: it changes nothing and prints how many rows of each kind hold a name, and how many old activity rows have a label unlike their file's, per organisation (ids only, never a name), and how many audit entries it would re-hash.
- With `--apply` it shows the dry run, asks you to type the database's name, and then does everything in one transaction. Any error rolls it all back.
- The audit log is hash-chained and its guard refuses every change. Inside that one transaction the script switches the guard off, blanks the fields, re-hashes every sealed entry from the first changed one to the head, switches the guard back on and checks the whole chain. If the chain was already broken it refuses and changes nothing. If the check after re-hashing fails, it rolls back.
- It writes one system entry to the audit log, `audit_log.redact_private_names` ("Old file names removed before go-live"), with the counts (labels set included) and the chain's old and new head hash. A head copied off the server before today matches `previous_head_hash` in that entry; copy the new head (Audit log, chain status) off the server again afterwards.
- A second run finds nothing and changes nothing.
- It refuses a database whose name looks like a test or check copy (`test`, `check`, `ci`, `tmp`, `scratch`) unless `--allow-test` is given.
- **Backups still hold the names.** Every backup taken before the run (the one just before it, the nightly ones and the encrypted off-site copies) still has the names and the old chain. Don't delete them early: let them expire under the usual keep period. If anyone restores a backup from before the run, run this script again straight after the restore (`ops/restore.sh` starts everything again, so stop `web jobs` first, as below).

```sh
cd /srv/selah
git rev-parse HEAD                      # the commit you upgraded to, with migration 0106
docker compose stop web jobs            # first, so nothing writes during the backup or the run
docker compose build jobs               # the tools image at this commit, with the script
ops/backup.sh
# Dry run: counts only, nothing changed.
docker compose run --rm --no-deps jobs npm run pre-go-live:clean-private-names
# Apply: type the database name (selah) when asked.
docker compose run --rm --no-deps jobs npm run pre-go-live:clean-private-names -- --apply
docker compose start web jobs
ops/readiness.sh
```

The next nightly `job:audit-check` should pass and print the new head. To see it at once: `docker compose run --rm --no-deps jobs npm run job:audit-check`.

**3. Test the tunnel live.** The cloudflared image was updated (2025.10.0 to 2026.10.4, PR #139) without a live tunnel test: on the test stack it pulled and ran, and `tunnel run` without a token failed with the same message as the old version, but no tunnel was started. Before go-live, with the real tunnel token on the server:

- Start the tunnel edge (`docker compose up -d` with the tunnel profile you use) and check `docker compose logs cloudflared` shows the connections registered, with no error.
- From outside the firm's network, open the app's public address: the sign-in page loads over HTTPS, and a file download and a PDF export work (they go through the same edge).
- Ask the assistant one question and watch a slow answer finish: the stream must stay open past 100 seconds (the waits from PR #208) and translations or summaries must finish as jobs (PR #211).
- If anything fails, set the image back to `cloudflare/cloudflared:2025.10.0` in `docker-compose.yml`, `docker compose up -d`, and note it in the incident register.

## When something goes wrong

### A personal-data breach

A breach is anyone seeing, changing, losing or destroying personal data they shouldn't: a client's files opened by another client, a stolen laptop with a session, a leaked backup, a wrong mail recipient.

**First hour: contain.**
1. Whoever notices tells the firm admin at once. The firm admin opens an entry in the incident register (below) with the time the firm became aware; the deadlines run from it.
2. Stop it spreading: switch off the accounts involved (the team page), end their sessions, rotate any secret that may have leaked (`.env`, then restart), and if needed stop the web app (`docker compose stop web`).
3. Keep the evidence. Don't delete anything. Export the audit log for the period (Audit log, Export) and note the chain's latest seal; save the server logs.

**First day: understand.**
4. From the audit log, find what was reached, whose data it was and how many people. File views, downloads, summary reads, sign-ins and refusals are all there.
5. Decide whether the breach may harm the people whose data it is. Write the reasoning in the register either way.

**Who is told.**
6. **The client.** Selah holds client data for the client, so under the data processing agreement the firm tells each client affected within the agreed time ([24] hours in the template), with what is known, the likely effects and what is being done, so the client can meet its own duties.
7. **SDAIA.** For the firm's own data (its staff, inquiries), the firm notifies SDAIA within 72 hours of becoming aware when the breach may harm the people concerned, as the Personal Data Protection Law's implementing regulations require: what happened, when, the kinds and rough number of people and records, the likely consequences, what was done and a contact. For client data the client decides and notifies, with the firm's help.
8. **The people affected.** Told without undue delay when the breach may cause them harm, with what to do (change a password, watch for phishing). In Arabic and English.
9. **The NCA.** If the client is in the scope of the NCA's Essential Cybersecurity Controls, tell it at once so it can report as those controls require.

**Afterwards.**
10. Fix the cause, check the fix, and run the restore drill if data was changed or lost. If you restore a backup from before the pre-go-live clean-up, run the clean-up script again afterwards (Before go-live, step 2); its old chain head is the `previous_head_hash` in the `audit_log.redact_private_names` entry.
11. Close the register entry with what was learned. Review the register at least once a year.

### The incident register

Kept by the firm admin outside Selah (so it survives Selah being down or compromised), one row per incident, including ones that turned out not to be breaches:

| Field | What to write |
| --- | --- |
| Number | INC-2026-001, and so on |
| Aware at | Date and time the firm became aware (the deadlines run from this) |
| Found by | Who noticed, and how |
| What happened | Plain description; systems and accounts involved |
| Data and people | Kinds of data, which clients, roughly how many people and records |
| Harm assessment | Whether it may harm the people concerned, and why |
| Contained at | When, and how |
| Client told | Which clients, when, by whom |
| SDAIA told | When and reference, or why not required |
| People told | When and how, or why not required |
| Cause and fix | Root cause, what changed, when it was checked |
| Closed at | Date, and who closed it |

### Other failures

- **The database won't start or is damaged.** Don't run anything that writes to it. Restore the newest backup that passes the drill (`ops/restore.sh`).
- **Stored files are missing.** To put them back without touching the database, copy the backup's `objects.tsv` into `backups/objects/` and run `docker compose run --rm --no-deps -v "$PWD/backups/objects:/backup" jobs npm run restore:storage -- /backup`. It only adds files the bucket lacks, after checking each sha256.
- **The audit chain check fails.** The nightly job prints the place where it breaks and prunes nothing. Treat it as a possible breach: compare with the seal kept off the server, and restore the newest backup whose drill passes for a copy of the log as it was.

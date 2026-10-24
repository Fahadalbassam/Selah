# Operations

Running Selah on the firm's server: backups, restoring, and what to do when something goes wrong (readiness item R3). Everything here runs on the server, from the repository folder that holds `docker-compose.yml` and `.env`.

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

On a new server: install Docker, check out the same commit (the manifest names it), fill `.env` with the same role passwords, `docker compose up -d db storage`, `docker compose run --rm setup`, then `ops/restore.sh`. Work done after the backup is lost; say so to the clients affected.

Tested with `SELAH_LOCAL=1`, which runs the same scripts with the tools on the machine instead of the containers.

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
10. Fix the cause, check the fix, and run the restore drill if data was changed or lost.
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

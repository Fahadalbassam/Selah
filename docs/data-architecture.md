# Data architecture

Where Selah keeps its data, how firm and client data are kept apart, how files are stored and opened, and what the assistant can reach. Sections marked **[Built]** describe the code as of the 2026-10-23 baseline (`drizzle/0000_baseline.sql`). Sections marked **[Proposed]** are recommendations that are not built yet.

## Summary

| Question | Answer |
|---|---|
| One database or several? | One PostgreSQL database (`selah`) with one schema. The firm and every client live in it side by side. |
| Are firm and client data separated? | Yes, by row, not by database. Every client-owned row carries the client's `org_id` and a `project_id`. Row-level security (RLS) in Postgres hides every row the signed-in person may not see. |
| Are we adding collections? | No. "Collection" is a MongoDB word. The Postgres equivalent is a **table**, and Selah has about 75 of them. Clients don't get their own tables. All clients share each table, and each row is tagged with its client. |
| Does each consultant get their own space? | No. Consultants are firm users, not tenants. What a consultant sees is worked out on each request from `client_assignments` (which clients they are on) and `project_members` (which projects they are staffed on). |
| How many buckets? | One private bucket today (`selah-evidence`). **[Proposed]** Two buckets, files and development, plus encrypted backups on a second machine. See [Bucket and folder layout](#bucket-and-folder-layout-either-store-proposed). |
| A folder per client? | Not today. Files are stored under random keys with no folders. **[Proposed]** Use a `org/<client>/project/<project>/` prefix per file, for exports, deletion and backups. Prefixes don't add security; the database check does. |
| Is R2 used? | No. The code speaks the S3 protocol, so the store can be RustFS on the server (today, in `docker-compose.yml`) or Cloudflare R2 by changing `.env`. **Decided 2026-10-22: self-hosted** on the Legion laptop, with backups to a second laptop. See [R2 or self-hosted](#r2-or-self-hosted-storage). |
| Can file access be secured? | Yes, and it already is. The bucket is private. A file is opened only through a one-minute signed link, which the server issues after checking the person's rights, and every download is audited. |
| Can the AI see the database or the bucket? | No. The AI service has no storage keys and no database connection. For each question the web app, acting as the signed-in person, searches under that person's rights and hands the model only the passages that survive. See [What the assistant can reach](#what-the-assistant-can-reach). |

## 1. The database [Built]

### One database, many organizations

```
organizations (kind = firm | client)
 ├─ org_memberships ── user (role: firm_admin, consultant, client_admin, client_manager, action_owner)
 ├─ client_assignments (consultant ↔ client, one lead per client)
 └─ projects (kind = internal | client, org_id = the client, firm_org_id = the firm)
     ├─ project_members (who is staffed)
     ├─ findings → recommendations → actions → evidence, reviews, …
     ├─ documents (+ document_shares)
     ├─ meetings, assessments, reports, KPIs, …
     └─ ai_chunks (the assistant's search index)
```

- The firm is one row in `organizations` with `kind = 'firm'`. Each client is a row with `kind = 'client'`.
- Every project-level table gets `project_id` and `org_id` from `scoped()` in `src/db/schema/app.ts`. A composite foreign key (`scopedFk`) ties the pair to `projects(id, org_id)`, so a row can't claim one client's project and another client's org.
- Internal projects belong to the firm (`org_id = firm_org_id`), so client roles never match them.

### Why not a database per client

| Option | Why not |
|---|---|
| A database per client | The firm works across clients: lead dashboards, workload, the admin's view, the reminder job. Each would need a query per database, and each migration would run once per client. Isolation would be stronger, but Selah's real risk is wrong access inside one client (a consultant on the wrong project, an action owner seeing a private file), and separate databases don't help with that. |
| A schema per client | Same cost as above, with less isolation than separate databases. |
| MongoDB collections per client | Gives up foreign keys, transactions across tables, RLS and pgvector, which the workflow and the permission-filtered search depend on. Rejected in the stack decision record. |

One database with RLS is the standard multi-tenant design for a product this size, and it is what the tests already prove.

### How the separation is enforced

Two layers. Both must allow a request (see [authorization.md](authorization.md)):

1. **`authorize()`** in the app checks organization, role, project membership or client assignment, the scope of the grant, and the visibility label.
2. **Row-level security** in Postgres is the backstop. Each request runs in a transaction that sets `selah.user_id`. The policy functions (`app_can_see_project`, `app_is_assigned_to_client`, `app_label_ok`, `app_dept_ok`, `app_engagement_mode`, …) then hide rows from other clients, other projects, other departments and other labels.

| Database role | Used by | Can bypass RLS? |
|---|---|---|
| `selah_owner` | migrations and background jobs (reminders, indexing, purges) | owns the tables, so yes. Never used by web requests. |
| `selah_app` | every web request | no (`NOBYPASSRLS`) |
| `selah_auth` | sign-in library | only the auth tables |

A table with no policy can't be read by `selah_app` (deny by default), and `tests/db/rls.test.ts` fails if RLS is off on any table.

### Visibility labels

Every private-capable row has a label:

| Label | Who can see it (on top of project access) |
|---|---|
| `shared` | the firm team on the project and the client |
| `firm_private` | firm only |
| `client_private` | that client only, not even the firm admin |
| `user_private` | only the person who created it |

### Per-client and per-consultant, in practice

- **A client** sees only rows with its own `org_id`, and inside that only its projects, departments (when on) and labels.
- **A consultant** sees a client's projects only when staffed on them, or all of them as that client's lead. Being on a client's team alone shows the client's name and team, not its projects.
- **The firm admin** sees all firm and shared data, but never `client_private` or another person's `user_private`.

## 2. File storage [Built]

### Layout

- One private S3-compatible bucket, `selah-evidence` (`S3_BUCKET`). In `docker-compose.yml` it runs as RustFS on the same machine as the database. `npm run storage:init` creates it and blocks public access.
- Each file is one object under a **random UUID key** (`documents.storage_key`). The key never contains the file name, the client or the project, so a leaked key reveals nothing.
- Everything else about the file is a row in `documents`: project, client, owner org, label, department, version, SHA-256, size, scan status and AI flag. **The database row is the source of truth for access; the bucket has no permissions of its own beyond "private".**
- Files are immutable. A new version is a new object and a new row (`supersedes_id`).

### Upload

1. The browser sends the file to the Selah server, never straight to the bucket.
2. The server checks size (20 MB), extension, declared type and magic bytes, and has ClamAV scan it. Uploads are refused while the scanner is down.
3. Inside one transaction it checks rights, writes the `documents` row and the evidence row, then stores the object with a SHA-256 checksum. If storing fails, the rows roll back.

### Download

1. The browser asks `GET /api/documents/:id/download`.
2. The server loads the row under RLS (another client's file looks "not found"), runs `authorize(document.download)` and refuses anything not scanned clean.
3. It signs a link that is valid for **60 seconds** and forces a download (`Content-Disposition: attachment`). It also writes the download to `audit_log`.
4. The browser fetches the file from storage with that link.

So file access is secured by the server's checks, not by folders. Even if two clients' files sat side by side under one prefix, neither could get a link to the other's file.

### Weak points today

| # | Gap | Effect |
|---|---|---|
| W1 | Flat keys, no per-client prefix | Exporting or deleting one client's files, or measuring their size, needs a database join first. |
| W2 | Objects are never deleted | Deleting a project (cascade), purging an inquiry or erasing a user removes rows but leaves objects behind. |
| W3 | One storage key with full rights to the bucket | The web app, the indexing job and setup share one key. A leaked key can read and delete everything. |
| W4 | No encryption at rest configured for RustFS or the database volume | Someone with the server's disk or a stray backup can read files and rows. |
| W5 | No backups yet | Already listed in [security.md](security.md). |
| W6 | A signed link works for anyone who holds it for 60 seconds | Small, but a copied link can be opened by someone else during that minute. |

## 3. Recommendations [Proposed]

None of these change who can see what. They change how the same rules are stored and operated.

1. **Per-client prefixes (W1).** New keys become `org/<org_id>/project/<project_id>/<uuid>`. IDs only, never names. Existing objects can keep their keys, since the key is read from the row. This is a two-line change in `services/evidence.ts` and `scripts/seed.ts`. Internal projects sit under the firm's org id, so the firm's files have a prefix too.
2. **Delete what the database deletes (W2).** A nightly owner job lists objects under each prefix and removes any whose key has no `documents` row and is older than a day. The delay covers an upload still in flight. Purge and erase jobs call it for their prefix.
3. **Narrow storage keys (W3).** The web app gets read and write keys for the bucket, without delete or bucket admin. The indexing job gets a read-only key. Only the cleanup job gets delete rights. R2 supports per-bucket tokens for this, and RustFS supports access policies per user.
4. **Encryption at rest (W4).** If self-hosted: put full-disk encryption (LUKS) on the server's data disk, which covers the Postgres and RustFS volumes. On R2, objects are encrypted with AES-256 automatically.
5. **Backups (W5).** Run a nightly `pg_dump` and copy the bucket, both encrypted before they leave the server (for example with `restic`), and keep a copy off the server. Test a restore once a term. Backups count as storage too, so their location follows the R2 decision below.
6. **Optional: stream private files through the server (W6).** For `firm_private`, `client_private` and `user_private` files, the server could stream the bytes itself instead of handing out a link, so no link exists to copy. The cost is server bandwidth. 60-second links are an accepted practice, so this is optional.
7. **Keep uploads going through the server.** Don't switch to direct browser uploads with presigned PUT links. The virus scan and type checks must run before a file is stored.

## 4. R2 or self-hosted storage

**Decision (Fahad, 2026-10-22): self-hosted.** Files stay on our own machine in RustFS, with the bucket and folder layout below, so moving to R2 later is a settings change. The server is the Legion laptop, and backups go to a second laptop (the Lenovo) over a LAN cable, see [Backups](#backups-self-hosted-proposed). Neither machine is running Selah yet. The comparison is kept here for the record.

**RustFS is not a cloud service.** It is a small program, run here in Docker, that turns a folder on a disk into an S3-style bucket. It is the self-hosted twin of R2, and Selah talks to both the same way. With RustFS, the files live on whatever machine runs it. Today that is the team's Linux server, the same machine as the database.

### Comparison

| | RustFS on our own machine | Cloudflare R2 |
|---|---|---|
| **Security of the store** | As good as the machine. We have to patch it, encrypt the disk, firewall it, and keep the storage port behind HTTPS. | Strong by default: AES-256 at rest, TLS, private buckets, and keys that can be scoped to one bucket. Run by a professional team. |
| **What protects client files from each other** | Selah's server check and signed links (section 2) | The same. The store never decides access, so this is equal. |
| **Data residency (PDPL)** | Files stay wherever the machine is, in Saudi Arabia. | No Saudi location. Enforced jurisdictions are the EU and FedRAMP; other regions only get best-effort hints. Real client documents leaving the Kingdom need a lawful transfer basis under the PDPL's transfer rules, which the firm should confirm. |
| **Durability** | One disk. A dead disk or a stolen laptop loses everything that isn't backed up. | Replicated by Cloudflare. |
| **Backups** | We must copy files and database dumps off the machine every night. | Files are already off the server. We still back up the database, and a second R2 bucket can hold the encrypted dumps. |
| **Cost** | Free; uses the disk. | Free tier of 10 GB, then about $0.015 per GB a month, with no download fees. A GP's test data fits in the free tier. |
| **Availability** | Only while the machine is on and online. A laptop that sleeps, travels or changes networks is a poor server. | Always on. |

**Is R2 secure enough?** Yes. The open question about R2 was never its security. It is where real client data is allowed to live. For the graduation project, with synthetic data, R2 is a good choice and saves us from building disk encryption and file backups ourselves. Before the firm puts real client files in, it should confirm that storing them outside the Kingdom is acceptable, or keep production on a server in Saudi Arabia. The code doesn't care which.

**A laptop as the server** works if it's set up as one: never sleeps on lid close or idle, stays on a wired connection, sits on a UPS or at least a surge protector, and has full-disk encryption (LUKS) so a stolen laptop exposes nothing. Its battery covers short power cuts.

### What switching to R2 would take

No code changes, only settings:

1. In the Cloudflare dashboard, create the buckets (below). Leave public access off and don't attach a custom domain.
2. Create an R2 API token with **Object Read & Write**, limited to the files bucket. Keep its access key and secret.
3. In `.env`: `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET=selah-files`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` from the token.
4. Remove the `storage` service from `docker-compose.yml` (or leave it unused).
5. Test once: upload a file, check it arrives with its SHA-256 checksum, download it through the one-minute link, and check that the link stops working after a minute.

### Bucket and folder layout (either store) [Proposed]

| Bucket | Holds | Who has a key |
|---|---|---|
| `selah-files` | every uploaded file (evidence, client documents, deliverables) | web app (read and write), indexing job (read only), cleanup job (delete) |
| `selah-files-dev` | test and development uploads, synthetic data only | developers |

Inside `selah-files`:

```
org/<org id>/project/<project id>/<document id>
```

- **A client** has one `org/<client id>/` prefix, with one sub-prefix per project. A client's whole export, size or deletion is one prefix.
- **The firm's internal projects** sit under `org/<firm id>/project/<project id>/`.
- **Consultants have no folder of their own.** Files belong to projects, not to the person who uploaded them. A consultant's upload goes under the client's project, and their personal (`user_private`) files sit there too, protected by the label rather than by the folder.
- **Ids only.** No client names, file names or titles appear in a key; those stay in the database. The last part is the document's own id, so each version (a new row) gets a new key.
- **Folders are for running the system, not for security.** A person never gets a key or a folder listing, only a one-minute link to one file after the server's check. Putting two clients in one folder or in a hundred makes no difference to who can open what.
- Backups are not a bucket here. They are an encrypted restic repository on the Lenovo, see below. (On R2 they would be a separate `selah-backups` bucket.)
- Today's files have flat random keys. They keep working, because the key is read from the row, and new uploads use the layout above.

### Backups (self-hosted) [Proposed]

The 3-2-1 rule: three copies, on two different devices, with one away from the building.

```
Legion (server)                                 Lenovo (backup), LAN cable only
 ├─ Postgres ── pg_dump -Fc ──┐                  restic rest-server --append-only
 ├─ RustFS ── rclone sync ────┼─ restic backup ─▶ /backup/selah  (encrypted repo, LUKS disk)
 └─ .env (kept separately) ───┘   02:00 Riyadh    └─ prune + check, run on the Lenovo
                                                  └─ weekly: copy to an encrypted external drive kept off-site
```

**Network.** A direct cable between the two laptops with fixed addresses (for example `10.10.0.1` and `10.10.0.2`). The Lenovo's firewall accepts only the restic port, only from the Legion, only on that cable. The Lenovo is never on the internet-facing network and runs nothing else.

**Nightly job on the Legion (02:00 Riyadh time):**

1. `pg_dump -Fc selah` into a staging folder. This is one consistent snapshot of the whole database, including the AI index.
2. `rclone sync` the `selah-files` bucket into the staging folder as plain files, through the S3 API. Copying RustFS's internal data folder directly isn't safe, because its format belongs to RustFS.
3. `restic backup` the staging folder to the Lenovo. Restic only sends what changed, so after the first night it's quick.
4. Write the outcome (time, size, success or failure) to a log, and alert the firm admin if no backup has succeeded in 36 hours.

**Encryption.** Restic encrypts everything on the Legion before it leaves (AES-256), so the Lenovo only ever holds ciphertext. The Lenovo's disk is also LUKS-encrypted. The restic password lives in the Legion's `.env` **and** on paper or in a password manager held by Fahad. Without that password the backups can't be read by anyone, including us.

**Ransomware and mistakes.** The Lenovo runs restic's rest-server in `--append-only` mode. The Legion can add backups but can't delete or overwrite them. A compromised or broken server can't destroy its own backups.

**Retention (run on the Lenovo, weekly):** `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`, then `restic check`.

**Restore test (once a month, and before any demo or hand-in; a recorded restore test is the GP's evidence that backups work):**

1. Restore the latest snapshot to a scratch folder.
2. `pg_restore` it into a throwaway database and compare row counts with the live one.
3. Pick ten random `documents` rows and check that each restored file's SHA-256 matches `documents.sha256`.
4. Write down the date, the time it took and any problem. An untested backup doesn't count.

**Off-site copy (for a real deployment; documented, not needed for the GP).** Both laptops sit in the same room, so a fire, theft, flood or power surge can take both. Once a week, copy the restic repository to an encrypted external drive and keep it somewhere else. Restic's `copy` command keeps it encrypted. An encrypted copy to a cloud bucket would also work, since the provider only sees ciphertext. Still, check with the firm before real client data leaves the Kingdom, even encrypted.

**What is not backed up:** the Ollama models (downloaded again), ClamAV signatures (downloaded again) and Docker images (rebuilt). The `.env` file and the restic password are kept separately from the backups, because they unlock them.

## 5. What the assistant can reach [Built]

### The AI never touches the bucket or the database

The AI service (`services/ai`) has no storage keys and no database URL (see `docker-compose.yml`). It gets only what the web app sends it for one question: the question and the allowed passages. A hosted model, if one is ever switched on, gets the same and nothing more.

```
             indexing job (selah_owner, read from bucket)
bucket ──▶  only files with AI flag on, scanned clean, not archived
             └─ text split into passages ─▶ ai_chunks
                 (copies project, client, label, department, owner, version, page)

question ─▶ web app (selah_app, under RLS)
             1. retrievalScope(): project, client, allowed labels  → inside the SQL WHERE
             2. RLS on ai_chunks: label rule + "can this person open the file?"
             3. surviving passages only ─▶ AI service ─▶ answer citing file, version, page
```

### How it knows whose data to search: the session

The model is never told who is asking, and it doesn't choose what to read. The web app decides from the sign-in session, on the server, for each question:

1. **Sign-in.** The person signs in (with two-factor for staff and client admins). The browser holds only an `HttpOnly` session cookie, which scripts can't read and which isn't sent to the model.
2. **Who is this?** `route()` looks up the session on the server and gets the user id. Anything the browser sends about its own role or client is ignored.
3. **What can they reach?** `loadPrincipal()` reads, from the database, the person's organization, role, client assignments, project staffing and departments.
4. **Rights become the query.** `asUser(userId)` opens a transaction as `selah_app` and sets `selah.user_id`. Every RLS policy reads that value. `retrievalScope()` adds the project, client and allowed labels to the vector search's `WHERE`.
5. **Only the results leave.** The passages that come back go to the AI service with the question. The model answers from those passages and must cite them.

The same path serves both sides:

- **A consultant** asking in a project they are staffed on gets passages from that project's shared and firm-private files and records. They don't get other clients, projects they aren't staffed on, or anything client-private.
- **A client manager** (if the assistant is turned on for clients) would get passages from their own organization's projects only, with shared and client-private content. The firm-private rows are already hidden from them by RLS. That is the "one line in `policy.ts`" switch in [authorization.md](authorization.md).

A question can't widen this. "Show me the other client's charter" still runs the same filtered query, and nothing from the other client is in the result to show.

### What decides "some yes, some no"

| Rule | Effect |
|---|---|
| **AI flag** (`documents.ai_indexable`, off by default) | A file is indexed only if its owner turns the flag on. The organization that owns the file controls the flag (`owner_org` scope), so a client decides whether its own documents are searchable. Turning the flag off deletes the file's passages at once (trigger). |
| **Scan and archive** | Only clean, non-archived files are indexed. Archiving deletes the passages. |
| **Visibility label** | Passages carry the file's label. A `firm_private` passage reaches firm staff only, `client_private` only that client, `user_private` only its creator. Changing the label deletes the passages and queues a re-index. |
| **The file's own rights** (baseline: AI sources, `with_file`) | A restrictive RLS policy: a passage from a file is returned only if the person can open that file right now, whatever the passage's own label says. |
| **Department** | Passages copy the file's department, and `app_dept_ok` applies to them as it does to the file. Refiling drops and re-indexes. |
| **Records** | Recommendations, actions, progress updates, reviews and meeting notes can also be passages, each under the same RLS as the record. |
| **Who may ask** | Firm admins and consultants today (`assistant.query`). Client managers are an open decision. Action owners stay out, because their file access comes from per-person shares, which the index does not carry. |

### How it is proven

`tests/db/ai-sources.test.ts` runs a search as every test user in every project. It runs once with their real scope and once with a forged scope that asks for every label. Every passage that comes back must be from a file that person can open. `tests/db/rls.test.ts` has the same "forged scope" check for `ai_chunks`. Filtering happens in the database before the model sees anything, never by asking the model to hold back.

### Gaps

- Scanned pages and images have no text recognition yet; they are listed (`ocr_pages`, `needs_ocr`) and left out of answers.
- The indexing job uses the full storage key. Recommendation 3 gives it a read-only key.
- No model has been run on real data; the tests use fake vectors.
- A hosted model sees masked text only (docs/assistant.md, "Masking names"). Names that aren't in Selah's records still reach it.

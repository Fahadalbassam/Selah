# How indicator figures reach Selah

A client's business indicators ([metrics.md](metrics.md#3-client-business-indicators-kpi-layer-b)) need figures every month or quarter. Clients differ in how much of their data they are willing to share, so each client chooses one of three modes. Whatever the mode, the figures stay **client-reported, not verified impact**, and only figures for the client's own indicators are kept.

| Mode | Arabic | What happens | What is shared |
|---|---|---|---|
| `typed` (default) | بلا بيانات | The client's admins and managers, or firm staff, type each figure in | Nothing from the client's systems |
| `files` | بعض البيانات | Someone uploads an Excel or CSV export when figures are due, checks what was read, then saves | The file the client picks; only the figures are kept, the file is not stored |
| `connected` | كل البيانات | A shared Google Sheet read once a day, or the client's own system sending figures with a key | Only the indicators the client's admin switches on for connections |

Typing figures in always stays possible, in every mode.

## Who decides

- The client's admin chooses (for a client the firm runs without client accounts, firm staff on the client). The choice records who made it and when, and tells the client's lead and deputy.
- Firm staff can only **suggest** a mode, typically during discovery. The client's admins are told, and the suggestion is preselected for them; it changes nothing until an admin confirms.
- The first time a client's admin opens their overview, a skippable card asks the question with "no data" preselected. It can be changed any time under **Data sharing** in their profile menu (`/indicators/data`).
- Stepping back from `connected` disconnects every connection at once. Figures already received stay.
- Indicators are created with the work (often from the starter library of 24 common indicators in `src/lib/indicator-templates.ts`), not during setup. Each client's indicators are its own: there is no fixed list every client must fill.

## Files (`/indicators/import`)

Upload, match, review, save. The reader (`src/lib/indicator-import.ts`) understands the three shapes real exports take:

- **One row per indicator, months across the top**: the monthly management report most firms keep in Excel.
- **One row per month, one column per indicator**: an ERP or HR system export, or a shared sheet.
- **One row per figure** with indicator, period, value and an optional note column.

Periods can be `2026-03`, `03/2026`, `15/03/2026`, `202603`, `Mar 2026`, `مارس 2026`, `آذار 2026`, `Q1 2026` or `الربع الأول 2026`. Numbers can use Arabic digits, thousands separators, a currency, `%`, or parentheses for negatives. Labels match an indicator by its **code** first, then by its Arabic or English name; a label that fits two indicators is never guessed. The person can change any match or leave a label out.

On review each figure is *new*, a *correction* (a different figure for a period that already has one; the earlier value stays in the history), *the same*, or left out with the reason (no indicator, no period, not a number, baseline month, not one of its periods, not started yet, switched off, twice in the file). Corrections are off until the person turns them on. On save the server reads the figures itself from the sheet as it was read (signed when the file was read), with the person's layout and matches, and refuses if the outcome differs from the review, for example because someone typed a value meanwhile. A percentage cell in Excel counts as the percentage it shows (12.5, not 0.125). At most 2,000 figures are saved at once. Files go through the same virus scan and type checks as every upload.

Firm staff may import for the client (for example, an export the client emailed). The batch is marked as brought in by the firm and the client's admins are told once.

## Connections (`connected` mode only)

At most five per client; only the client's admin adds or disconnects them. Figures arrive under the name of the person who connected it and under that person's access, so someone who loses access brings nothing more in. Only indicators the admin switches on under **From connections** accept figures from a connection.

**Google Sheet.** In Google Sheets: File › Share › Publish to web, pick the tab and CSV, and paste the link (an ordinary share link to a sheet anyone with the link can view also works). Selah checks the link before connecting and shows which labels matched. The `job:indicator-feeds` job reads each sheet once a day (corrections on). Three failures in a row tell the person who connected it. Only `docs.google.com` and Google's own download hosts are read; a firm can allow more hosts with `INDICATOR_SHEET_HOSTS` (comma-separated). Links must be HTTPS, redirects are checked at every hop, and a sheet over 2 MB is refused.

**System key.** For an ERP, a BI tool, or an automation service (Power Automate, Zapier, n8n). The key (`slk_…`) is shown once; Selah stores only its hash.

```sh
curl -X POST https://selah.example/api/indicator-feed \
  -H "Authorization: Bearer slk_..." \
  -H "Content-Type: application/json" \
  -d '{"values":[{"indicator":"complaints","period":"2026-10","value":31,"note":"from the CRM"}]}'
```

`indicator` is the indicator's code (set on the data page) or its id; a key is exact, so names are not matched here. Up to 500 figures and 512 KB per request, 60 requests per key per hour. The answer:

```json
{"added":1,"corrected":0,"unchanged":0,"results":[{"index":0,"status":"add"}]}
```

Each result is `add`, `correct`, `same` or `refused` with a `reason` (`unmatched`, `not_connected`, `no_period`, `bad_value`, `baseline`, `not_a_period`, `future`, `inactive`, `duplicate`). An unknown or disconnected key gets 401 and is written to the audit log.

## Records

- `client_indicator_settings`: the client's mode, who chose it and when, and the firm's latest suggestion.
- `indicator_feeds`: connections (sheet link or key hash and its last four characters, who connected it, last read, last error, failures in a row). Disconnecting is the only change allowed.
- `indicator_imports`: one row per file, sheet read or delivery, with counts and who brought it in. Each value from it carries its channel (`typed`, `file`, `sheet`, `api`) and its batch, shown on the indicator's history.

The database rules are listed in [rules.md](rules.md#metrics-and-business-indicators); all three tables are frozen when a client leaves.

## Running it

`job:indicator-feeds` runs in the jobs container's daily loop (`scripts/jobs.sh`). It needs `DATABASE_OWNER_URL` (to list the sheets due) and `DATABASE_APP_URL` (to save figures as the person who connected each sheet).

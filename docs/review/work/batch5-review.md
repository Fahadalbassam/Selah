# Batch 5 review (branch `batch5/client-page-words`, f260965)

Independent adversarial review, 19 Nov 2026. I fixed nothing and committed nothing. The checks ran in the reviewer's own worktree against `selah_test_r`, which I reset (dropped schema `drizzle`, `DROP OWNED BY selah_owner`) and migrated from empty. The branch has no migrations, and `origin/main` (127e3da) is already merged in.

## Verdict

**Not ready to merge. One blocker:** the meetings "Waiting for you" word, the batch's one new database query, never shows. Its SQL compares a column with itself, and no test runs it.

The rest of D3 holds where I attacked it:
- Every stored state in the seven tables maps to exactly one of the six words.
- Only `verified_complete` is green. "Accepted", "Not needed", "Not applicable", "Held", "Cancelled" and "Pitch" are grey.
- No word reaches a client that a client should not read. Drafts never reach a client reader; that is row-level security, unchanged.
- "Waiting for you" goes to the reader's side only.

The client page's tabs keep everything the old page and its two sub-pages had. Each part is gated as before. The audit sentences reveal nothing that the old Details column did not already show.

Six things should be fixed with it:
- The meeting page and the meetings list disagree.
- The inquiry status word contradicts the current step.
- The inquiry steps hide "Book a discovery session" until the firm admin has done the conflict check.
- Four notices and links still land on Overview, but what they point at is now on People or Setup.
- The meetings subquery also counts meetings that are already over.
- There are no database tests for the new SQL.

## Blocking

**B1. `listMeetings` "unanswered" is always false, so no meeting ever reads "Waiting for you".**
- `apps/web/src/services/meetings.ts:95`: ``sql`exists (select 1 from meeting_attendees a where a.meeting_id = ${meetings.id} and …)` ``. In a single-table select, Drizzle writes a column in a `sql` template without its table name. Rendered with `toSQL()` it is `exists (select 1 from meeting_attendees a where a.meeting_id = "id" and a.user_id = $1 …) from "meetings"`.
- Inside the subquery, `"id"` resolves to `a.id` (meeting_attendees has an `id` column), not `meetings.id`. `EXPLAIN VERBOSE` on `selah_test_r` shows it: `InitPlan 1 … Filter: (… (a.meeting_id = a.id) …)`. The subquery is uncorrelated and is never true.
- Scenario: Khalid (client admin) is invited to "Steering committee, week 3" and has not answered. On the project's Meetings tab (`projects/[id]/page.tsx:668-672`) he reads **لم يبدأ / Not started**, not **بانتظاركم / Waiting for you**. The placement table and the builder's own note both promise "Waiting for you". `tests/status-words.test.ts` checks only `meetingPlacement()` with a hand-made boolean. Nothing runs the query, so no test caught it.
- The same pattern already exists, by luck, in `queries.ts:198` (`projectNotClosed`: `p.id = "project_id"`). There it resolves to the outer column only because `projects` has no `project_id`. The pattern is fragile wherever it appears.
- Fix: write the outer column with its table explicitly, for example ``sql`… a.meeting_id = ${sql.raw('"meetings"."id"')}` ``, or use a lateral or left join on the reader's own attendee row. Add a database test: an invited, unanswered reader reads true; after answering, false; the organiser, false; someone not invited, false. Run it against the current code first and see it fail.

## Should fix

**S1. The meeting page does not say what its list says.** `apps/web/src/app/(app)/meetings/[id]/page.tsx:113-115` still draws `t(\`status.${meeting.status}\`)` ("Scheduled" / «مجدول») in an `open` tone. Scenario: once B1 is fixed, Khalid reads "Waiting for you" on the Meetings tab, opens the meeting, and the header says "Scheduled". The placement table names the meeting page as a place where "Waiting for you" shows, and D3 says the detail page shows the word with the exact state beside it. Fix: draw `WordBadge` with `meetingPlacement(status, unanswered)`, with the exact state beside it as on the action page.

**S2. An inquiry after its discovery session reads "Waiting for the client" while its current step is the firm's.** `apps/web/src/lib/status-words.ts:123` maps `discovery_done` to waiting on the client. `inquiry-steps.ts` makes step 4, "Send the proposal", current, with the owner's solid button "Proposal sent". Scenario: Sara records the outcome "Good fit". The header badge turns amber, **بانتظار العميل**, while the steps card tells her to send the proposal. The rule is that "waiting for" names who must move next. The error starts in `docs/placement.md` (Inquiries row); the builder followed it. Fix: `discovery_done` should be In progress (or waiting on the firm), in the code and in the placement table. `proposal_sent` stays "Waiting for the client".

**S3. The steps take away booking the discovery session before the conflict check.** `apps/web/src/lib/inquiry-steps.ts:88-92`: the discovery step has a button only once step 2 is done, and step 2 is the firm admin's alone.
- The server lets the owner book from `new`, `triaged` or `discovery_scheduled` (`services/inquiries.ts:337-343`; booking moves the inquiry forward). The old page offered **Book a discovery session** to the owner whenever no session was pending.
- Scenario: Noura (consultant, the inquiry's owner) marks a new inquiry read. Step 2 is now current, and she reads «يفحص مدير المكتب تعارض المصالح ويسجّل النتيجة». She has no way to book the session until Sara records the check.
- The same happens to a legacy inquiry at `discovery_done` with the check not done: the owner can no longer press "Proposal sent".
- Either the product owner decides that the conflict check gates discovery (then say so in `docs/intake.md` and enforce it on the server), or the owner keeps the booking as an outline button while step 2 waits.

**S4. Notices and links still open Overview, but what they point at moved to People or Setup.**
- `apps/web/src/services/today.ts:465`: the firm admin's home row "Omar asked to join Rawdah" (**اتخاذ القرار**) links to `/clients/:id`. The approve and decline buttons are now on People. She lands on Overview and needs a second click on the notice.
- `apps/web/src/services/notifications.ts:232` (`client_ai.*`, "the firm sees the client page's card") and `:236` (`client.pack_received`): the client-assistant card and the export packs (`OffboardingCard`) are on Setup now. The notice opens Overview, where neither card is.
- `apps/web/src/app/(app)/team/departure-dialog.tsx:63`: a "client lead" holding links to `/clients/:id`. Setting the lead is on People.
- Fix: use `clientTabHref(id, "people", "join-requests")`, `clientTabHref(id, "setup")` and `clientTabHref(id, "people")`. `tests/client-page.test.ts` "no link points at an old sub-page" checks only the two old addresses, not the moved cards.

**S5. Once B1 is fixed, a meeting that is over still reads "Waiting for you".** The subquery does not look at the time. The home's "to reply to" list does: `services/home.ts:220`, `gte(meetings.endsAt, now())`. Scenario: a meeting last Sunday was never marked held, so it is still `scheduled`, and an invitee who never answered sees amber "Waiting for you" on the Meetings tab for good. They can still answer, but there is nothing left to answer for. Fix: add `and meetings.ends_at >= now()` to the condition (or in `meetingPlacement`'s caller), so the list agrees with the home.

**S6. Tests for the new SQL and for the reader prop are missing; most new tests read the source.**
- There is no database test for `unanswered` (B1 proves the gap) or for `nextDue`. A useful `nextDue` test: an action owner's Projects card shows the next due date of their own actions only, not an earlier date from a colleague's action on the same project.
- `client-page.test.ts`, `october-batch5.test.ts` and the last block of `status-words.test.ts` grep the source for strings. They pass even when a call site passes the wrong `reader` (for example `reader="firm"` on a client screen). No test renders a client screen and checks for "Waiting for you".
- The table tests in `status-words.test.ts`, `inquiry-steps.test.ts` and `audit-sentences.test.ts` are real. Remapping `accepted` to plain Verified fails "only a verified action is green". Swapping firm and client in `wordKey` fails the revision-requested cases.

## Notes

- **N1. Two placement tables are not wired.** `dateRequestPlacement` and `closeRequestPlacement` have no caller. The action page's date requests still draw the raw `status.*` ("Pending / Approved / Rejected", `actions/[id]/follow-through-panels.tsx:184`). The placement table says "Accepted" and "Declined", and `docs/placement.md` now claims "every list and badge draws the word from this table". It is firm-side, so this is not a leak; either wire it or soften the doc line.
- **N2. `inquirySteps()` offers "Mark as read" and "Proposal sent" from `can.forward` alone** (`inquiry-steps.ts:86,94`). `forward` is `FORWARD[status]` for any reader and is not checked against `inquiry.work`. Today `inquiry.read` and `inquiry.work` have the same scope (firm admin any, consultant assigned), so nobody sees a button they cannot press. If read is ever widened, they will. Gate on `can.work` in the lib.
- **N3. The audit sentences are safe for a client admin.** `app_audit_entries` (0023) already nulls `resource_id`, `reason` and `meta` on refusals for client readers, and returns only their own people's events. The sentences take no meta values except the from and to state. "Details" shows only what the old Details column showed, with nothing new and nothing firm-only. A client admin sees the exact state in a status-change sentence ("Revision requested"), as the placement table intends for records.
- **N4. One word per thing (4.7) for the inquiry.** The inquiry page and nav call it «الطلب» / «الطلبات الواردة». The new audit sentences call it «استفسار» ("تحويل استفسار إلى شركة", "تعديل استفسار"), as the older labels already did. A firm admin reads two words for one thing. The other 4.7 items («متعثر», «المسؤول», «طلب» for four things) are not addressed in this batch; say so in the hand-back if that is intended.
- **N5. The Projects card's late flag also counts actions waiting for the firm.** `nextDue` includes `awaiting_review` (OPEN_STATUSES). A client reader can see red «متأخر منذ …» on a project whose only late item is with the consultant. This matches `isOverdue` elsewhere, so it is consistent, but the red date does not say whose move it is.
- **N6. The old `/clients/:id/people` and `/departments` now redirect anyone, signed in or not, firm or client.** They used to answer 404 to non-admins. The target page answers 404 to non-firm readers and does not check whether the client exists before redirecting, so nothing leaks. It is just a change from "404" to "redirect, then 404".
- **N7. The project-closing word, In progress, and the client-reader rules** ("Waiting for you" on the reader's side, the firm reading "Waiting for the client", "Waiting for the firm" for the firm's own move) all follow `docs/placement.md`.
- **N8. The People and Setup tabs have no solid button.** "Add a consultant" is outline. This is not wrong (the screen standard asks for at most one), but each tab then has no main action.

## Check results (TZ=UTC, `selah_test_r`)

- `npm run lint`: clean.
- `npm run typecheck`: clean.
- `npm test`: 61 files, 971 passed, 2 skipped.
- `npm run db:migrate` from empty, then `npm run test:db`: 87 files, 1293 passed, 0 failed.
- Probes: `toSQL()` of the `listMeetings` select shape, and `EXPLAIN VERBOSE` of the rendered SQL on `selah_test_r` (B1). Both are read-only, with no data written.

# Where each state shows (the placement table)

October review, item 1 (page audit section 7), written in batch 4 before the shared request and evidence row was built, and followed by it. Every state of every kind of thing a person meets in Selah, the visible word it falls under, the one "yes" verb at its level, and where it shows. New screens follow this table; a new state gets its row here in the same pull request.

## The rules behind the table

- **Six visible words** (decision D3): **Not started** («لم يبدأ») · **In progress** («قيد التنفيذ») · **Waiting for the firm** («بانتظار المكتب») / **Waiting for you** («بانتظاركم»; the firm reads "Waiting for the client») · **Needs attention** («يحتاج متابعة») · **Verified** («تم التحقق») · **Closed** («مغلق»). Lists and homes show the word; the detail page shows the exact state beside it. Batch 5 replaces the badges' words; until then the badges keep today's exact labels, and the column "word" below says which of the six each one becomes.
- **One "yes" verb per level.** **Accept** («قبول») for the parts: an evidence item, a document request, a date change. **Verify** («اعتماد») for the action only, the consultant's check that the work is done. Nothing else is called "verify", and nothing else turns green.
- **"Waiting for" names who must move next**, never who is late. The reader's own side is "you" or "your company", never "the client".
- **A closed action says how it ended**: "Closed: risk accepted" («مغلق: قُبلت المخاطر»), "Closed: not applicable", "Closed: partly done", "Closed: replaced by …". Closed is never green.
- **A file asked for is one idea in two places** (page audit 4.5): "the firm asked you for a file". An evidence item lives under its action (it proves that action); a document request lives on the project's Requests and files tab (the firm needs it to understand the company). Both use the same row (`RequestRow`, `components/request-row.tsx`) and the same words: the item's title, its state word, its due date, its files, one outline main button (**Send a file** for the side asked, **Accept** for the firm), the rest in the row's ⋯.

## Actions

| State (stored) | Word, firm reader | Word, client reader | Main step on the action page (one solid button) | Shows on |
|---|---|---|---|---|
| `draft` | Not started (with "Draft" on the page) | never shown (D6) | Release to owner (firm) | firm only: Plan, Actions, the action page |
| `assigned` | Not started | Not started | Start work (owner, coordinator side) | Plan, Actions, the owner's home ("waiting for you"), the action page |
| `in_progress` | In progress | In progress | Send for review (opens the one file dialog) | Plan, Actions, home when late, the action page |
| `blocked` | Needs attention | Needs attention ("stopped") | Resume work, under the reason | Plan chip "blocked", Actions filter, homes, the action page |
| `awaiting_review` | Waiting for the firm | Waiting for the firm ("with the consultant since …") | Reviewer: Verify (or First sign-off / Second sign-off), Send back as outline | Plan, Actions "awaiting review", the firm's home "to review", the owner's home "with the consultant" |
| `revision_requested` | Waiting for the client | Waiting for you ("sent back") | Send the revised file for review (one step) | Plan, Actions, the owner's home "waiting for you", the action page with the reason as "what happened last" |
| `verified_complete` | Verified | Verified | none (no next-step card) | Plan, Actions, progress counts, the owner's home "finished" (folded) |
| `closed` + outcome | Closed: *outcome* | Closed: *outcome* | none (the closing note is "what happened last") | Plan, Actions, progress counts, the owner's home "finished" (folded) |

Late is not a word: it is the date in red beside the word ("due 5 Jan", "late since 5 Jan"), and the "late" filter.

## Evidence items (`evidence_requests`, on an action)

| State | Word, firm | Word, client | Main button (firm) | Main button (client, or firm recording for a firm-run client) | Shows on |
|---|---|---|---|---|---|
| `open` | Waiting for the client | Waiting for you | none (menu: Not needed) | Send a file | The action page, "What to send" |
| `submitted` | Waiting for the firm | Waiting for the firm | Accept (menu: Not accepted, Not needed) | none | The action page; the firm's review card when the action waits for review |
| `rejected` | Waiting for the client ("not accepted: reason") | Waiting for you ("not accepted: reason") | none (menu: Ask again, Not needed) | Send a file | The action page |
| `accepted` | Verified at item level: "Accepted" | "Accepted" | none | none | The action page |
| `waived` | Closed at item level: "Not needed: reason" | "Not needed: reason" | none | none | The action page |

## Document requests (`info_requests`, on a project)

| State | Word, firm | Word, client | Main button (firm) | Main button (client) | Shows on |
|---|---|---|---|---|---|
| `requested` | Waiting for the client | Waiting for you | none (menu: send a no-login link, Not applicable, edit, remove) | Send a file | Requests and files tab; the client's home "documents asked of you"; the named owner's home |
| `received` | Waiting for the firm | Waiting for the firm | Accept (menu: another file, return it) | none (menu: another file) | Requests and files tab |
| `requested` after a return | Waiting for the client ("returned: reason") | Waiting for you ("returned: reason") | none | Send a file | Requests and files tab; the client's home |
| `reviewed` | "Accepted" | "Accepted" | none (menu: ask again) | none | Requests and files tab |
| `not_applicable` | Closed at item level: "Not applicable: reason" | the same | none (menu: ask again) | none | Requests and files tab |

The stored word for the firm's yes on a request is `reviewed`; on screen it is **Accept** / «قبول», as for an evidence item.

## Date requests (`deadline_requests`, on an action)

| State | Word, firm | Word, client | Main step | Shows on |
|---|---|---|---|---|
| `pending` | Waiting for the firm | Waiting for the firm ("your request to move the date to … is with the consultant") | Reviewer: Accept the new date (solid), Decline (outline), in the next-step card | The action page (next-step card for the reviewer, "what happened last" for the client); the firm's home "decisions waiting" |
| `approved` | "New date …, agreed by …" | the same line | none | The action page, one plain line; the firm's date history |
| `rejected` | "Declined" | "The new date was declined on …" | none | The action page, one plain line |

## Meetings

| State | Word | Main step | Shows on |
|---|---|---|---|
| `scheduled`, the reader invited and not answered | Waiting for you | Join (the call link) as the solid button; the answer as three choices | Meeting page; homes "meetings this week" and "to reply to" |
| `scheduled`, answered | Not started (the date) | Join | Meeting page; homes |
| `held` | Closed at its level: "Held on …" | none (follow-ups carry their own state) | Meeting page, the project's Meetings tab |
| `cancelled` | Closed: "Cancelled" | none | The project's Meetings tab |
| follow-up `open` | Waiting for its owner | Done (the owner) | Meeting page; the owner's home "your follow-ups" |
| follow-up `done` | "Done" | none | Meeting page |

## Reports

| State | Word | Main step | Shows on |
|---|---|---|---|
| firm-private (a draft status pack) | firm only: "Draft" | Issue (the firm) | The project's Progress tab, firm only |
| shared (`shared_at` set) | "Shared on … by …" | Download PDF | Progress tab for everyone on the project; the client's home "reports" |

## Inquiries (the firm only)

| State | Word | Main step |
|---|---|---|
| `new` | Waiting for the firm | Assign an owner |
| `triaged`, `discovery_scheduled` | In progress | Book or hold the discovery session |
| `discovery_done`, `proposal_sent` | Waiting for the client (the prospect) | Record the answer |
| `won` | Closed: won (the client is created) | none |
| `lost`, `declined`, `withdrawn`, `spam` | Closed: *the reason* | none |

## Projects and closing

| State | Word | Main step | Shows on |
|---|---|---|---|
| `draft` (a pitch) | firm only: "Pitch" | Start the project | Projects (firm) |
| `planned` | Not started | the plan | Projects |
| `active` | In progress | the plan | Projects, homes |
| request to close, `pending` | Waiting for the firm | The firm admin: accept or decline (on the Closing tab) | The firm admin's home "decisions", the project's Closing tab |
| `closing` | In progress ("closing") | Settle each open action (handed over, deferred, withdrawn, waived), then close | The Closing tab; the firm admin's home while it waits for the final close |
| an action `handed_over` at closing | the action's own word, plus "handed over to you" as "what happened last" | the owner's main step stays as in the action table | The owner's action page and home |
| `closed` | Closed | none (the pulse is answered on the Closing tab) | Projects (folded), the Closing tab |

## Changing who owns an action (decision D1)

Not a state: the owner changes, the status does not. It shows as one history line on the action ("Given to … by …"), one audit entry, and a notice to the new owner (on the action), to the old owner (on the project, never on the action they no longer read), and to the client's lead and deputy and the consultants staffed on the project (on the action).

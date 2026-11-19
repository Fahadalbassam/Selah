# Review: branch `phase2/help-in-app` (adversarial)

Diff: `git diff origin/main...HEAD` in worktree `agent-a577170ab08247468` (head 9b879cf). Read-only review. No files changed, nothing pushed, no database touched.

## What I ran

- `npx tsc --noEmit` (apps/web): exit 0.
- `npx eslint` on every changed .ts/.tsx file: exit 0.
- `npx vitest run` (whole unit suite): 64 files, 1004 tests, all pass. This includes `help-in-app.test.ts` (copy == `docs/handbook/`), `tips.test.ts` and `recheck-text.test.ts` (fault 4).
- I ran temporary vitest probes (deleted afterwards) against `parseInline` / `parseGuide` with hostile input, and against the four real guides in `handbook-content.ts`.
- I grepped the diff and the commit messages for [partner firm] / [partner firm] and its other spellings, university / جامعة / student / graduation project, and common real first names. **Nothing found.** The only hit was the existing `GraduationCap` lucide icon import in `nav-user.tsx`, which is an icon, not a mention.

## Verdict

**No blocking findings.** The guide reader cannot produce raw HTML or a `javascript:`/`data:` link. A role cannot be shown the other side's guide. The route requires sign-in, two-factor setup and consent. Typecheck, lint and tests all pass. There are three should-fix wording items, one should-fix hardening item, and some notes.

---

## Should-fix

### S1. Link check lets `/\host` through, and a browser resolves that to another site
`apps/web/src/lib/handbook.ts:93`, `const SAFE_HREF = /^(\/(?!\/)|#)/;`

The check only refuses `//`. A backslash after the first slash passes. I verified this with a probe:
`parseInline("[x](/\\evil.example)")` returns `{kind:"link", href:"/\\evil.example"}`, and `new URL("/\\evil.example", "https://app.example/help/guide")` resolves to `https://evil.example/` (WHATWG URL parsing treats `\` as `/` for http(s)).

- **Failure scenario:** a handbook author pastes or mistypes `[Help](/\help.example)` into `docs/handbook/client/en.md`. `npm run handbook:copy` copies it, the CI copy check passes, and the client guide then shows an in-app-looking link that opens an outside host.
- **Severity:** the content comes from the repo, not from users, so this is not exploitable by a viewer. That is why it is should-fix, not blocking.
- **Fix:** also reject `\` (for example `/^(\/(?![\/\\])|#)/`, or refuse any href containing `\`), and add the case to the "never links out of the app" test next to the existing `//evil.example` case.

### S2. The "Shared" tooltip contradicts "Limited audience" and department labels
`apps/web/messages/en.json:6843`, `tips.visibility.shared` = "Both the firm and the company's people on the project see it." Shown by `VisibilityBadge` on the project document list (`src/app/(app)/projects/[id]/page.tsx:606`) to every reader, including client readers, and in the file explorer.

- **Failure scenario:** a file is shared but its audience was narrowed (`d.limited`). The same row draws `AudienceMarker` ("Limited audience") and, right next to it, a tooltip saying the company's people on the project see it. A firm user who reads the tooltip concludes the left-out person can see the file.
- The same over-claim applies to department-scoped files: the file explorer shows a Department row, and a client manager outside that department does not see the file.
- **Fix:** soften the wording, e.g. "Shared between the firm and your company; who exactly sees it follows the project, its department and any audience set on it." Or pass `limited` to `VisibilityBadge` and use a different tip.

### S3. The archive tooltip promises something the retention job breaks
`apps/web/messages/en.json:6889`, `tips.icons.chatArchive` = "Moves the chat to the archive; you can bring it back at any time."

`scripts/purge-chats.ts` (`app_purge_chats`) deletes chats a set number of days after their last message, and after their project closes. That applies to archived chats too; the existing `assistant.keepHint` says "It is still deleted on schedule."

- **Failure scenario:** a consultant archives a chat to keep it. It is deleted at the idle limit, which the tooltip said would not happen.
- **Fix:** e.g. "Moves the chat to the archive; you can bring it back until it is deleted on schedule."

### S4. The client manager role tooltip misstates the visibility rule
`apps/web/messages/en.json:6852`, `tips.roles.client_manager` = "Follows the company's work, only in their own departments when the company uses departments." Shown through `RoleTip` in the team tables (`team/page.tsx`, `team/people-admin.tsx`).

The handbook (`docs/handbook/client/en.md`, `#client-manager`) says a client manager "sees company-wide work and their own department's work … on the projects they were added to". The tooltip drops both the company-wide (undepartmented) work and the "projects they were added to" limit.

- **Failure scenario:** a client admin reads the tooltip and decides a manager cannot see company-wide actions, which they can. Or the admin assumes the manager sees every project, which they don't.
- **Fix:** align the tooltip with the handbook, e.g. "Follows company-wide work and their own department's, on the projects they were added to." Make the same change in Arabic.

---

## Notes

**N1. The Actions empty state hints at hidden drafts for client readers.**
`messages/en.json:406`, `actionsPage.empty` = "No actions for you yet. Actions appear here once they are released on your projects." `src/app/(app)/actions/page.tsx:42` shows it to every role, clients included.
- "Once they are released" tells a client manager or action owner that actions exist before they are released, which is the draft state D6 keeps from the client.
- It does not give a count or say "other", so the fault-4 test passes. Still, the fault-4 rule ("nothing about what is hidden") suggests a reader-specific line, e.g. "Actions given to you appear here."
- `meeting.noSummary` ("…once the firm writes and confirms it") is the same kind of thing, but milder.

**N2. Every non-control `Hint` adds a tab stop.**
`src/components/hint.tsx:47` puts `tabIndex={0}` on the wrapper span. `StatusBadge` now always carries a tip, so the action board, the actions table, the closure table, the team tables (`RoleTip`) and the inquiry list each gain one Tab stop per row. A 50-row action list means 50 extra Tab presses to get past it.
- On the plus side: there is no button inside a button. Every `asChild` use wraps a single Button or Link; I checked every `StatusBadge`, `WordBadge`, `KindWord`, `RoleTip` and `VisibilityBadge` call site and none sits inside a `<Link>` or a button. RTL follows the document direction.
- To reduce the tab stops, consider skipping the tip in dense tables, or making the row's own link carry the description.

**N3. Some tips sit on disabled buttons and never open.**
Hints on buttons that can be disabled (zoom in/out at the limit, `newChat` when there are no projects, `removeOption` when there are only two options, `MeetingMenu` and `RemoveAttendee` while busy) never open, because the disabled button gets `pointer-events-none` and loses focus. This is not a regression (the old `title` did not work there either), but in those states the tooltip is not there.

**N4. Duplicate DOM ids in the English firm guide.**
`<a id="firm-admin|deputy|consultant|observer"></a>` comes right before `### Firm admin`, `### Deputy`, `### Consultant` and `### Observer`. `slug()` gives each heading the same id, so `GuideView` renders two elements with the same id. I found this with a parser probe on the real `HANDBOOK.firm.en`.
- `#consultant` still lands correctly, because the span comes first, but the HTML is invalid.
- The Arabic headings slug to Arabic, so they do not collide.
- **Fix:** skip the heading id when an anchor block directly precedes it.

**N5. Links to other handbook files become bare text.**
The guides' intro sentence links the other language (`[en.md](en.md)`, `[ar.md](ar.md)`). In the app this renders as the plain words "The Arabic guide is ar.md." This is cosmetic. Consider stripping that clause in the reader, or in the copy step.

**N6. Unrecognised HTML lines are dropped silently.**
`parseGuide` drops any line that starts and ends with a tag. For example, `<summary>Text</summary>` loses "Text" (verified). An unclosed `<!--` swallows the rest of the guide (`handbook.ts:172`). Neither occurs in today's guides. It is safe, but a future author would lose content without any warning; a test that fails on unrecognised HTML lines in `docs/handbook` would catch it.

**N7. The handbook comments point at test files that do not exist.**
The comment at `src/lib/handbook.ts:5` refers to `tests/handbook.test.ts`, and the one in `src/lib/welcome.ts` refers to `tests/welcome.test.ts`. Neither file exists; both checks live in `tests/help-in-app.test.ts`.

**N8. The second-review tooltip says "another consultant".**
`tips.secondReview.signOff` says the action waits "until another consultant signs". The second signer comes from `app_second_reviewers` and can be any eligible firm staff member, not only a consultant. This is minor.

## Checked and fine

- **`/help/guide` access.**
  - The page is behind `withPrincipal`: no session goes to `/sign-in`, no membership to `?error=no_access`, and two-factor setup and consent redirect as on every page.
  - The part shown comes only from `principal.role` through the total `PART_OF` map. Query string, hash and locale cannot change it; locale only picks ar/en.
  - "Observer" is a project-level flag on a consultant, not a `Role`, so an observer gets the firm guide.
  - A user with several memberships gets the same single principal the rest of the app uses.
  - There is no help layout that would 404 firm staff.
  - The page 404s when the part is missing.
- **Bundling.** `HANDBOOK` is imported only by server modules (`help/guide/page.tsx`, `help/page.tsx`, `layout.tsx`, `lib/nav.ts`). The client components `app-sidebar.tsx` and `nav-user.tsx` use `import type` only, so the firm guide text does not ship to client browsers.
- **Rendering.** `GuideView` builds only React elements, with no `dangerouslySetInnerHTML`.
  - In my probes, `<script>`, `<img onerror>` and inline `<b>` came out as escaped text or were dropped.
  - `javascript:` and `https:` links came out as text.
  - Images are dropped, and anchor ids are limited to `[A-Za-z0-9_-]`.
  - Every `#…` link in the four real guides points at an anchor that exists, and every role's `guideHrefFor` anchor exists in both languages.
- **Client-side wording.** Status tips are chosen per reader, and the test checks the client side never says "the client". The other tips a client can see (dispositions, assistant on/off, meetings, data modes, icons) do not say "the client". The firm-private and inquiry/project tips are only drawn on firm screens.
- **Tip wording against the rules.** I spot-checked these against `authz/workflow.ts`, `policy.ts` and the services, and they match: Closed means without verification, observer rights (`OPEN_TO_OBSERVERS`), cancelling a closing returns the project to active (`app_cancel_closing`), removing an attendee queues a calendar cancellation (`removeAttendee`), and a removed comment leaves a line.
- **CI.** The copy check normalises CRLF, so it passes on Windows checkouts. CI runs `npm test` from `apps/web` with the full repo checked out, so `docs/handbook/` is present.

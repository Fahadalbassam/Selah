# Review: `feature/org-chart-tree` (org chart, part 2: the drawn tree, the Structure tabs, the PDF)

Reviewer: independent agent, 18 Nov 2026.
Checked at `1f47ae4` (one commit on `origin/main` `4c9706b`; main has since gained `1a9438f`, documents only).
Method: read the whole diff, then `services/org-chart.ts` (part 1's readers that part 2 calls), `drizzle/0091_org_chart.sql` (the database rules those readers rest on), `authz/authorize.ts` and `policy.ts`, `server/page.ts`, `server/http.ts`, `services/pdf.ts` and the export button. Ran every check on `selah_test_u`, reset and migrated from empty. Then:

- **Probes Q1 to Q6**: a throwaway database test file in my worktree (`tests/db/zz-review-probe.test.ts`, deleted afterwards, never committed), calling `getStructure()` and `orgChartPdf()` as each kind of reader.
- **Real PDFs**: a throwaway script that builds the PDF page exactly as `orgChartPdf()` and `renderPdf()` do, from the branch's own functions, and sends it to the PDF service already running on this machine. No database was used. I rasterised the files with poppler and looked at them.
- **The lead's dev server** (port 3930, your walkthrough data): read-only GETs of HTML pages as lead2, lead and owner, with the session files from your capture. I did not call the PDF route there, because it writes an audit row in your database.
- **Mutations**: I removed one guard at a time in my worktree, ran the branch's tests, and restored the file.

Line numbers are at `1f47ae4`.

## Verdict

**Nothing blocking. Five should-fix points need fixing or a decision from you before merge.**

No reader can get a name, a draft or another client's chart that the part 1 services would not give them:

- not on the tab, in the PDF, through `version`, through `asOf`, in an error, in the audit entry, or in the data the page sends to the browser;
- the escaping holds for typed names, unit names, titles and the client's name;
- the tab, the page and the PDF route agree on who gets in.

The problems are about the product, not privacy:

- The Structure tab ships before anyone can create a structure, and its firm text says people "can start one" when nobody can.
- A printed old version looks like the current one.
- The PDF is unreadable for a company with more than about ten departments.
- The client side goes against the product owner's "only the Structure tab when departments are off", and nobody asked him.
- The tab row breaks the pattern of the existing link tabs.

All checks pass: lint, typecheck, 599 unit tests and 1024 database tests. On the full database run, 3 files timed out in their 10-second setup while the shared Postgres was slow; all 3 pass when run again (see "Check results").

## Your two questions from the screen check

**(1) lead2 on `/clients/<Al-Nukhba>/structure`: the skeleton, status 200.** This is the app-wide loading-screen pattern, not something in this page, and nothing leaks.

- **It is app-wide.** `clients/[id]/loading.tsx` (already on main) wraps every page under the client, `/structure` included. When `notFound()` is thrown after the skeleton has been sent, React marks that part of the page to be drawn by the browser. The stream carries the not-found marker (`NEXT_HTTP_ERROR_FALLBACK;404`, a `noindex` meta tag), and the browser draws "Not found" once its JavaScript has loaded. The same request as lead2 to the existing client overview `/clients/<Al-Nukhba>` behaves the same, and so does owner's existing `/departments`: status 200, the marker, no server-drawn heading.
- **It resolves in the same response.** With the dev server warm, the whole refused response took 1.4 to 2.1 s, the marker in the last chunks. The first, cold request took 11.3 s, which is dev-server compiling. Your capture was most likely taken before the browser had drawn the client-side Not found, which in dev waits for the JavaScript to compile. Owner's capture shows it once drawn. I could not take a browser screenshot as lead2 myself to prove this.
- **No chart data in the refused stream.** Compared with lead's allowed page (same address, 5 drawing boxes, every typed name), lead2's response, and lead2's `?version=draft`, have none of these: no drawing markup (`oc-unit`, `oc-pos`), none of the six typed names, no position title such as «مستشار قانوني», not even the client's name «شركة النخبة القابضة». The only org-chart words in it are the app's whole message catalogue, which next-intl sends with every page (words, never data).
- **A side finding (N1).** lead2 on the existing firm Departments page `/clients/<Al-Nukhba>/departments` does not get Not found. `getEngagement()` throws `ForbiddenError`, and `withPrincipal()` turns only `NotFoundError` into Not found, so the page fails with a server error (`ForbiddenError: forbidden`, digest 4202594461, in the dev stream). This is on main already, and nothing leaks. But that page is now a tab beside Structure.

**(2) Where "Download PDF" sits.** The code is the same on both pages: the button is in `PageHeader` and the tab row comes after the header (`clients/[id]/structure/page.tsx:42-53`, `departments/structure/page.tsx:28-39`). On the firm page, the back link above the header pushes the header down, which is why it looks different. It does matter for the screen standard, but for another reason (S5): the existing link tabs on `/actions`, `/review` and `/oversight` sit above the page header. This branch puts its tabs below the header, so the one page action sits above the tab row and looks as if it belongs to all three tabs. The tab row also moves up and down between Overview, Departments and Structure.

## Findings

### Blocking

None.

### Should fix

**S1. The Structure tab ships before a structure can be made, and the firm's text says people "can start one".**

- **Where:** `messages/en.json:5354` (`noneFirm`), `:5356` (`draftOnly`), the same keys in `ar.json`; the tabs in `clients/[id]/page.tsx:206`, `clients/[id]/departments/page.tsx:36` and `departments/page.tsx:26`.
- **What is wrong:** nothing in the app calls `startChart()`, `addUnit()` or `publish()`. There are no routes and no screens until part 3 (outline editor) and part 5 (publishing). Only the walkthrough seed fills a chart.
- **Failing scenario:** once this is merged and deployed, every real client is affected.
  - The lead of Rawdah opens the client page, sees the new **الهيكل** tab, and reads «يستطيع البدء فيه مدير الشركة أو قائد العميل أو نائبه…» ("…can start one"). There is no button or page anywhere to do it.
  - Rawdah's client admin and managers get a new **الهيكل التنظيمي** tab on Departments that can only ever say "not published yet".
  - With a draft, `draftOnly` tells the firm the client sees nothing "until the lead, the deputy or the firm admin publishes this draft", and there is no way to publish.
  - This goes against the brief's rule 5 (production app, no "coming soon") and the screen standard (say what to do next, and make it possible).
- **Fix (your call):**
  - Either hold this branch until the part 3 editor and the part 5 publishing screens can merge with it, or show the tabs only where there is something to read. For the firm: a chart exists. For the client: a published version exists. That reveals nothing about a draft, because the client already sees published versions.
  - In either case, reword `noneFirm` and `draftOnly` to say only what is true on the day it merges.

**S2. A printed earlier version looks exactly like the current one.**

- **Where:** `services/exports.ts:498` (`meta`), `:509` (`footer`); messages `orgChart.pdf.meta` and `pdf.footer`.
- **Failing scenario (probe Q4):** Acme's admin downloads version 1 after version 2 has replaced it.
  - The heading reads "Version 1 · in effect from Jan 1, 2026".
  - The footer reads "… · Version 1 · in effect from Jan 1, 2026 · printed on Nov 18, 2026", with the names as they were on the day it was replaced.
  - Nothing says the version was replaced, or which day's holders are shown. The screen says both ("Replaced on …", "Who held each position on …", `structure-body.tsx:58-59`).
  - Printed for a board, or attached to a resolution, it reads as the structure in force today. The product owner's reason for versions is that the board approves each one.
- **Fix:** for a superseded version, add "Replaced on {date}" (and, when there are names, "Who held each position on {date}") to `meta` and to the footer, the way the draft gets `metaDraft` and `footerDraft`. Add a test that prints V1.

**S3. The PDF cannot be read for a company with more than about ten departments, and a long department prints a blank page.**

- **Where:** `lib/org-chart-html.ts:122-129` (`fitZoom`), `:152`, `:67` (`break-inside:avoid`); `services/exports.ts:503`.
- **What is wrong:** the overview puts every department in one row and shrinks the whole drawing to fit the page width. Body text is 0.8125rem at a 10pt base, so the printed text size falls with each department (probe Q6, and real renders through the PDF service):

| Departments in one row | Text size on A3 | Text size on A4 |
|---|---|---|
| 8 | 8.1pt | 5.8pt |
| 12 | 5.6pt | 3.8pt |
| 16 | 4.1pt | 2.8pt |
| 25 | 2.7pt | 1.8pt |
| 40 | 1.6pt | 1.1pt |

- **What the renders showed:**
  - 16 departments on A4: one thin line of 16 tiny boxes across the top, and about three-quarters of the page left empty.
  - A department with 60 positions on A4: page 2 has only the department's heading. The box is "do not split", so it jumps to page 3, then runs over four pages with no heading. One position breaks between its title and its name: page 6 starts with «اسم الموظف 47».
  - The product owner's own example (8 departments) prints well on A3, and the walkthrough chart prints well on A3 and A4. Many Saudi companies have 12 to 25 departments under the chief executive, and their overview would be unreadable.
- **Fix:**
  - Let the overview wrap into rows, for example at most N boxes across with a floor on the zoom, instead of shrinking without limit.
  - Allow a long unit to break between positions (`break-inside:avoid` on each position, not on the whole unit), so no page is left with a heading only.
  - Add a test with 20 departments that checks the zoom stays above a floor.

**S4. The client's Departments page keeps both tabs when departments are off, against the product owner's text, and nobody asked him.**

- **Where:** `departments/page.tsx:26`, `department-tabs.tsx`.
- **What the text says:** the decision (`2026-11-17-gate-a-followups.md`, "Where it sits") says: "if the client has departments off, the page shows only the Structure tab".
- **Failing scenario:** a manager at a client with departments off clicks **الإدارات** in the sidebar. She lands on an empty "Departments are off, so they don't limit who sees what yet" list, with the structure one tab away. The product owner wanted the structure there.
- **Why it matters:** the builder's reason is sound for the admin, because the on/off switch lives on that tab. But the brief says decided points are not reopened, and that disagreements go to Fahad.
- **Fix (your call, or ask him):** for example, open the Structure tab first when departments are off, keep the Departments tab only for the admin (who needs the switch), and hide it for managers.

**S5. The new link tabs sit below the page header, unlike the existing ones.**

- **Where:** `clients/[id]/page.tsx:206`, `clients/[id]/departments/page.tsx:36`, `clients/[id]/structure/page.tsx:53`, `departments/page.tsx:26`, `departments/structure/page.tsx:39`.
- **The existing pattern:** `/actions`, `/review` and `/oversight` put `ActionsTabs` first and `PageHeader` after it (`actions/page.tsx:25-26`, `review/page.tsx:23-24`, `oversight/page.tsx:22-23`). The page's own button, the Excel export, then sits under the tabs and plainly belongs to that tab.
- **What this branch does:** the tabs go after the header and, on the overview, after the pitch and archive banners.
- **The effect:**
  - "Download PDF" sits above the tab row, so it looks like an action for Overview and Departments too. This is your question (2).
  - The tab row is at a different height on each of the three firm pages, so it jumps when you switch tabs.
- **Fix:** put `ClientTabs` and `DepartmentTabs` directly under the back link and above `PageHeader` on all five pages, as on `/actions`. Write it down in `ui-guidelines.md` beside `LinkTabs`.

### Notes

- **N1 (on main already).** lead2, or any firm person who is not on Al-Nukhba's team, gets a server error, not Not found, on `/clients/<Al-Nukhba>/departments`. `getEngagement()` throws `ForbiddenError` (`clients/[id]/departments/page.tsx:21`), and `withPrincipal()` (`server/page.ts:52`) only turns `NotFoundError` into Not found. Nothing leaks, but the brief says a denial answers 404. This branch now links that page as a tab. The fix is either to check `department.read` before `getEngagement()`, or to make `withPrincipal()` treat `ForbiddenError` like `NotFoundError` everywhere.
- **N2. Three of the product owner's screen features now have no part.** He asked for "collapse and expand per unit, zoom and pan, … focus on one department" (decision, "The diagram"). The builder says collapse/expand and focus are not built, and zoom and pan is not built either (the drawing only scrolls sideways). The progress checklist's F43 parts 3 to 5 do not list any of the three, so they would be lost. Add them to a part, or record that he dropped them. Excel export is in part 4 already.
- **N3. Test strength (your item 7).**
  - The new tests do fail without the guards that are the branch's own. Two mutations:
    - **M1.** Without the "picked version must be in this client's list" check (`org-chart.ts:433`), 2 of 16 database tests fail: "another client's chart is 404, and so is its version through this client's address", and the PDF refusal test. The firm admin then reads Other's version under Acme's address.
    - **M3.** With the "without names" switch ignored in the tree (`org-chart-tree.ts:162`), 1 database test fails ("A4, a depth, and a copy without names hold no name at all") and 1 unit test fails ("…drops every one for a copy without names").
  - **M2.** Without the firm-only check on `draftSummary` (`org-chart.ts:423`), no test fails (16/16 and 18/18). Row-level security already hides the draft row from every client reader (the version policy at 0091:958-959). So that guard is a second line that cannot be reached, and the real rule is tested end to end here and in part 1. That is acceptable.
  - Not tested at all:
    - the pages' own checks (`orgKind`, and the role list on the client page);
    - the rate limit (probe Q5 shows it works: the 11th PDF in ten minutes is refused before printing);
    - "marked unpublished on every page" (the test uses `toContain`, so one banner would pass, though the code does put it on every page).
  - Suggest one test each for the rate limit and for a banner count equal to the page count.
- **N4. The client tab is called «الهيكل التنظيمي», not «الهيكل».** The decision says "Structure / الهيكل" on both sides. The longer label is plainer for a client and the test records it as intended, but it is a change from the text. Confirm with him, or note it in the log.
- **N5. Wording.**
  - The firm's `hint` (`en.json:5352`) says "This client's published structure … today" also when the draft is shown.
  - `names.noDepartment` ("…and you have no department in it") is shown to a manager whose client has departments off, where the real reason is that departments are off.
  - The draft banner calls the firm «الشركة» («مسودة الشركة»). On a page about a company's own structure, a reader can take that as the client company. Elsewhere the app also says «المكتب» for the firm, so «مسودة المكتب» or «مسودة فريق الاستشارات» would be clearer.
- **N6. A version published with an effective date in the future** shows as "Version 2, current · In effect from <future date>", with today's holders. That follows from part 1, which makes a version current when it is published, but the word "current" is misleading until the day it takes effect. Raise it with part 5 (the publishing screens).
- **N7. The PDF file name.** It is always "Organisation structure.pdf" / «الهيكل التنظيمي.pdf». Two versions, or two clients, download under the same name. Adding the client and the version number would help.
- **N8. Typed names show as stored on English screens and PDFs.** This is the builder's own note: Arabic names in an English PDF. It is a known limit of typed names, not a leak.
- **N9. The `/actions` tabs.** Same markup, `aria-label`, `aria-current="page"` and focus ring as before. The container gained `justify-start max-w-full overflow-x-auto` (it was `justify-center`). At 768 px and wider nothing moves, because the row is `w-fit`. The scroll container clips at most one pixel of the active tab's shadow. Keyboard order and focus are unchanged.

## What I checked and found sound

**Names (your item 1).**

- `getStructure()` reads only through `getPublishedChart()`, `getDraft()`, `getVersion()` and `listVersions()`, and adds no name. Holder names come only from `app_org_chart_holders()`.
- **The PDF.** "With names" (`names=1`) cannot add any: `names = options.names && shown.names !== "none"` (`exports.ts:486`), and the tree only keeps names the database sent (`named && name`). "Without names" drops every one. A manager's PDF with "show names" off has no name; with it on, only her branch (branch test, and the mutation in N3).
- **`version`.** A version must be in this reader's own `listVersions()`, which runs under row-level security (`org-chart.ts:433`). For a manager an earlier version is titles only (`withHolders`, part 1). There is no `asOf` on the page or the PDF route; zod drops unknown query keys, and `getVersion()` would ignore it for a manager anyway.
- **The draft id** gives a client the same 404 as any unknown id.
- **Another client's version** under this client's address gets 404, the firm admin included.
- **Escaping (probe Q1).** A typed holder name `<img src=x onerror="alert(1)">`, a unit name `</style><script>…`, a title `Chair "<u>` and a client name `Acme <b>bold</b>` all came out escaped on the screen drawing and in the PDF page. The footer is plain text, escaped by `pdf.ts footerHtml()`. The `next-intl` value for "Reports to: {title}" is escaped after translation.
- **The audit entry** `org_chart.export` holds the client id, format, number, size, depth and the names flag, never a name. It has labels in both languages and an area.
- **Errors** are the same `not_found` for every refusal (`server/http.ts:282-295`). The service's own error texts ("draft not found", "version not found") never reach the browser, and they are the same whether a draft exists or not (probe Q2).
- **The page's data sent to the browser.** `StructureBody` is a server component, so the structure itself is never serialised. The only client component, `StructurePdfButton`, gets the address, a version id (never "draft" for a client), the levels, the depth and a yes/no for names. Holder ids, user ids, dates and the resolution id never leave the server.

**Who sees it (your item 2).**

- The page checks, `canReadStructure()` (`org_chart.read`) and the database rules agree:
  - the firm admin, lead, deputy, staffed consultants and observers read;
  - a consultant on the team who is staffed on nothing, and another client's lead (lead2, probe Q3), get 404 on the service and the PDF, and the tab is hidden for them;
  - the client admin and managers read;
  - action owners: the page checks the role, the policy has no grant, the database refuses;
  - another client's admin and manager get 404;
  - a minimal-records client shows titles only;
  - a restricted client's admin reads every name.
- The firm page refuses client people, and the client page refuses firm people.

**The draft (your item 3).**

- **Probe Q2.** Take a client with no chart and a client whose firm draft holds a unit, a position and a typed holder name. Their admin and manager get byte-identical `getStructure()` output, apart from the client's name, and identical errors for `version=draft`, the draft's real id and a random id. Both PDFs are refused the same way.
- The "nothing published yet" line is the same either way.
- The version list a client gets never holds the draft, and numbers are given only when a version is published, so no count gives it away.
- The firm's draft PDF carries the banner on each page section and "Unpublished draft" in the footer on every page.

**The PDF (your item 4).**

- **What goes to the PDF service:** no script, no remote address, no `file:` address. The fonts are sent with the page and referred to by file name. Nothing from the user goes into CSS or an attribute except escaped text and a numeric `zoom`.
- **The rate limit** (10 per 10 minutes per person, shared with the other PDFs) is checked before printing.
- **Audited.**
- **Right to left:** `dir="rtl"` and `lang` are set on the page and the drawing, the connectors use logical properties, and the Arabic render reads right to left with internal audit beside the chief executive on a dotted line.
- **Paper:** `@page` A3 or A4 landscape, and the service honoured both (pdfinfo: 1191×842 pt and 842×595 pt).
- **The footer** carries the client's name, the version, the effective day and the day printed, with page numbers.

**No judging (your item 5).** No counts, spans or scores anywhere; plain greys from the tokens (all six exist in light and dark, `globals.css`); "Vacant / شاغر" in a dashed outline only; planned numbers and specialties are not drawn. The message test rejects judging words.

**The screen standard (your item 6).**

- One outline "Download PDF" on the page. One solid "Download" inside its dialog.
- The levels control is links, not a second action.
- The client pages say "your company" (the test checks it).
- The `/actions` tabs are unchanged (N9).

**The walkthrough seed.** Twelve positions, one vacancy (legal counsel), five accounts and six typed names, show names on. `walkthrough-seed.test.ts` checks it. Your capture matches it.

## Check results

All on `selah_test_u`, reset (drop schema `drizzle`, `DROP OWNED BY selah_owner`) and migrated from empty, `TZ=UTC`:

| Check | Result |
|---|---|
| `npm run lint` | pass (exit 0) |
| `npm run typecheck` | pass (exit 0) |
| `npm test` (unit) | 40 files, 599 tests passed |
| Database tests (`vitest.db.config.ts`, all 76 files) | 1024 tests. Full run: 1003 passed, 3 failed and 18 skipped, all in 3 files (`department-move`, `indicator-data`, `status-pack`). Each failure is "Hook timed out in 10000ms" on `TRUNCATE "user", organizations CASCADE`; `pg_stat_activity` showed that statement waiting on disk sync (`DataFileImmediateSync`), with no other client on `selah_test_u`. Run again on their own: 3 files, 24/24 passed. None of the three touches the org chart. The branch's `org-chart-tree.test.ts` passes (16/16), and so does `walkthrough-seed.test.ts` |
| Probes Q1 to Q6 (throwaway file) | 6 passed. They are evidence, not assertions of the findings: Q4 prints the superseded meta and footer, Q5 the rate limit, Q6 the zoom table |
| Mutations (my worktree, restored after each) | M1 (no own-list check): 2 database tests fail. M3 ("without names" ignored): 1 database and 1 unit test fail. M2 (draft summary for anyone): nothing fails, because the draft row cannot reach a client past the database rule (N3). After restoring: 16/16 and 18/18 again, and `git status` clean |
| Real PDFs (local PDF service) | 4 renders: walkthrough shape in Arabic on A3 and English on A4; 16 departments on A4; one department with 60 positions on A4 (S3) |

All throwaway files (the probe test and the render script) were deleted from my worktree. Nothing was committed. No container was started, stopped or reset. No database other than `selah_test_u` was written.

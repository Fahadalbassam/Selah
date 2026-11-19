# UI guidelines

How every Selah screen should look and behave, so the firm side and the client side read as one product. New screens follow this file; when a screen needs something it does not cover, add the rule here in the same PR.

The short version:

- **Build from shadcn/ui and Animate UI first.** Custom components are allowed only when no official block or component fits, and they must be made of shadcn primitives and the tokens below so they look like the rest.
- **Monochrome.** Black, white and greys. Colour appears only for status, and stays muted.
- **Arabic first, right to left.** Every layout works in RTL and LTR with logical properties.
- **Desktop and tablet only** (768 px and wider). No phone layouts.
- **Every screen is backed by a real API and workflow state.** No mock screens, and no "demo", "prototype" or "sample" labels anywhere in the UI.

Contents: [1. Building blocks](#1-building-blocks) · [2. Layout and dimensions](#2-layout-and-dimensions) · [3. Spacing](#3-spacing) · [4. Type scale](#4-type-scale) · [5. Colour and contrast](#5-colour-and-contrast) · [6. Shape and elevation](#6-shape-and-elevation) · [7. Components](#7-components) · [8. Motion](#8-motion) · [9. RTL and LTR](#9-rtl-and-ltr) · [10. Firm and consultant side](#10-firm-and-consultant-side) · [11. Client side](#11-client-side) · [12. Public and sign-in pages](#12-public-and-sign-in-pages) · [13. Review checklist](#13-review-checklist)

---

## 1. Building blocks

### Where components come from, in order

1. **shadcn/ui** components in `apps/web/src/components/ui` (official, free). Add new ones with the shadcn CLI, then run `npx shadcn migrate rtl <file>` on each new file.
2. **shadcn blocks** (free, official) for whole regions: `sidebar-07` (the app shell), `dashboard-01` (summary cards and tables), and the login blocks for auth pages.
3. **Animate UI** (`@animate-ui/react`, https://animate-ui.com) for animated icons (`components/animate-ui/icons`) and backgrounds (`components/animate-ui/backgrounds`). Add them with the shadcn CLI from `https://animate-ui.com/r/<name>.json`. The CLI imports `cn` from a package called `cn`: change it to `@/lib/utils` and uninstall that package.
4. **Selah components** in `apps/web/src/components` (listed below). Reuse these before writing anything new.
5. **A new custom component**, only if 1 to 4 have nothing that fits. It must be built from shadcn primitives (`Card`, `Badge`, `Button`, `Table`, `Item`, `Empty`...), use only the tokens in this file, and get a short doc comment saying what it is for.

Do not edit `components/ui/*` for a single screen. Change the look of one usage with `className`; change the component itself only when the change should apply everywhere (and say so in the PR).

### Selah components

| Component | Use it for |
|---|---|
| `PageHeader` | The one title block at the top of every app page. `meta` holds badges about the page's subject (status, kind, visibility) next to the title; `children` are the page's actions, grouped at the end of the row. |
| `SectionHeader` | A titled section inside a page (an `h2`, one step below the page title), with an optional description and actions. |
| `StatTile`, `Meter` | A labelled number, and a share-of-a-whole bar that fills from the reading direction's start. |
| `ToneBadge`, `StatusBadge` | Every coloured badge. `StatusBadge` maps action states to tones; `ToneBadge` takes a tone directly (section 5.3). |
| `EmptyState` | Every empty list or panel (shadcn `Empty`): a quiet icon, one line, an optional action. |
| `ActionsTable` | Any short list of actions (title, project, owner, due date, status): the home, a project, a department. |
| `ActionFilterLinks`, `WaitingLinks`, `ActionFacets`, `ActionBoardTable` | The Actions page (page audit 4.6, `components/action-filters.tsx`, `action-facets.tsx`, `action-board-table.tsx`). The lists are links with their count (`secondary` for the one shown, `ghost` for the rest; `aria-current`), the firm's rules after a thin line; the filter is in the address (`actionsHref()` in `lib/action-filters.ts`: `/actions?filter=late&project=…`), so the home and other pages link to a list and its count is the number the list holds. Under them, the choices that narrow it (client for the firm, project, owner as a person picker, department), each applied at once and kept in the address, with a ghost **Clear**; a choice is drawn only when it offers more than one value. The table adds what the list is about: the waiting days and, for the firm, the sign-off stage on "awaiting review"; why the action is on the list (all the rules it breaks, one row per action) on a rule list, with **Remind the owner** in the row's ⋯ menu (`ruleActionRowPlan()`). The Excel export sits in the header on the whole list only, since the workbook is not filtered. |
| `ProjectsTable`, `ProjectViewLinks` | The Projects page as a table, for the firm (`/projects?view=table`, `app/(app)/projects/projects-table.tsx`): open, late, blocked, the oldest waiting review, the lead, the client's last activity. Counts only, never a health word (D5); each count is a link to its Actions list. Cards and Table are two links under the header, beside the kind. |
| `ListPager` | Previous and next links under a long list, with "1–50 of 230". Hidden when everything fits on one page. Pages are a `?page=` link, so they survive a reload; read the value with `pageParam()`. |
| `ExportButton` | Downloads an export (Excel or PDF) from a GET route in the reader's language, with a busy state and an inline error (the PDF service being down is said plainly). |
| `FormDialog`, `ApiButton` | A dialog that posts a form, and a button that calls one API route. Both refresh the page and show errors in the person's language. A `FormDialog` opened from a row menu takes `control` instead of a `trigger` (`useDialogControl()` in `hooks/use-dialog-control.ts`: the menu holds whether it is open, and the focus goes back to the menu's button when it closes); the larger dialogs (the answer to a request, moving a department's work, an indicator and its values) take the same `control`. |
| `RowMenu`, `useRowCall` | The menu (⋯) at the end of a dense row or a page header (`components/row-menu.tsx`): the row's rare actions, so the row shows at most one button of its own. Each item carries `allowed`, the server's own flag for that row; an item that is not allowed is not drawn. An item either runs a call (`useRowCall()`: refresh on success, a toast on failure, after its `confirm` question if it has one) or opens a dialog through `control`. The button is labelled "More for <name>" («خيارات أخرى: …»), opens with Enter, Space or the arrow keys, follows the reading direction, and gets the focus back when a dialog or confirmation from it closes. Removing or ending items come last, after a line, in the problem colour. Which button a row shows and what goes in its menu is decided in `lib/row-actions.ts` from the server's flags only (`tests/row-actions.test.ts`). |
| `SendFileDialog`, `FileField`, `AfterSendChoice` (`components/send-file-dialog.tsx`) | **The one way to send a file** (page audit U05, batch 4). Every signed-in place that takes a file opens it: the action's next step and each item of "What to send" (`ActionSendFile`, `app/(app)/actions/[id]/send-file.tsx`), a document request's answer, **Add a file** on a project and in the Files card, a file's **New version**. Same title words (**إرسال ملف / Send a file**), same order: what the file is for (the item, the project, how the client sent it), the file or a file already in Selah (two tabs, where the place allows reuse), the note, who sees it (the `AudienceField`, where the place allows it), and last, on an action the reader may send for review, the choice **Send for review now / Save without sending**. With an evidence list a file always goes to an item ("Not an item on the list" covers the rest). The signed-out upload page uses its `FileField`. `uploadErrorKey()` maps the server's refusal to one set of words. `tests/action-page.test.ts` fails if any other screen draws a file field (the three imports, which read a workbook or a transcript, are named there). |
| `RequestRow` (`components/request-row.tsx`) | **"The firm asked you for a file"**, one row in two places (page audit 4.5): an evidence item under its action ("What to send") and a document request on the project's Requests and files tab. Title, state word and tone, other quiet badges, one line of facts (who it is asked of, the due date), the last decision's reason, the files, then one outline button (**Send a file** for the side asked, **Accept** for the firm) and the rest in the row's ⋯ (`RowMenu`). Which state shows which word and button: [the placement table](placement.md). |
| `ActionPanel`, `ActionPageMenu`, `WhatToSend`, `OwnerChange` (`app/(app)/actions/[id]/`) | The action page (page audit 4.5, batch 4): see section 11, "Action page first". The next-step card is built by `nextStep()` (`lib/action-next.ts`, `tests/action-page.test.ts`) from the server's own permissions only. |
| `useConfirm` | Every "are you sure?" step (shadcn `AlertDialog`). Never use `window.confirm`: it ignores the theme and the reading direction. Asked from a menu item, pass the menu's button as `returnFocus`. |
| `page-skeletons` | `HeaderSkeleton`, `StatCardsSkeleton`, `TableSkeleton`, `CardGridSkeleton`, `CardSkeleton`, `DetailSkeleton` for `loading.tsx` files. Match the real page's layout. |
| `BrandMark`, `BrandWordmark`, `SidebarBrand`, `BrandLoader` | The logo and the branded spinner. Use `BrandLoader` inside busy buttons. |
| `Translatable` | User-written text that may be shown in the other language on demand. |
| `AnimatedNumber`, `MetricHistory`, `Topography` | Counting numbers, the progress trend chart, and the animated contour background. |
| `FilesSidebarItem`, `FileBrowser` | The file explorer: the animated folder at the bottom of the sidebar opens a floating card (not modal) with search, the file tree, the selected file's details and "Add a file". The card is dragged by its header or moved with the arrow keys when the header has focus, stays inside the window, remembers its position per browser, and closes with Escape. `FileBrowser` with `pick` is the same tree inside the evidence dialog, to reuse a file instead of uploading it again. |
| `AudiencePicker`, `AudienceMarker` | Who sees a document (not evidence) or a meeting. Closed, one quiet line ("Seen by: everyone with access · Customise"); opened, a two-way switch ("Everyone with access, except…", the default, or "Only these people…") and one chip list grouped Firm and Client (on the client's own item, only its people, under "Your company"). It only takes people away: the server hands it the people who can already see the item, and it never fetches. Locked people (the person setting it, the uploader, the client admin, the firm admin, the lead and deputy, the organiser, everyone invited, the person asked for a file) are never offered for "except" and stay as fixed chips on an "only" list, the reason in a tooltip. An "only" list with nobody on it is refused with a plain message. Controlled: keep `mode` and `selected`, save `check.value` from `onChange`; the rules are in `lib/audience.ts`. `AudienceMarker` is the "Limited audience" badge shown to the people who still see the item; it never names or counts the people left out. |
| `ProjectMenu`, `PlanAdd`, `PlanActions`, `RemoveFromProject` | The project page (page audit 4.3, batch 3, `app/(app)/projects/[id]/`). Five tabs, Plan · Requests and files · Meetings · Progress · People, and Closing while the project is closing or closed or a request to close waits for the firm's answer; an answered request stays in the activity record at the foot of Progress (`projectTabs()` and `closingTabShown()` in `lib/project-tabs.ts`); a tab the reader has nothing to open in is not drawn (an action owner has no Progress). Old `?tab=` addresses redirect (`OLD_TABS`, `oldTabTarget()`). Under the title one status line of counts (October review, item 4; D5: counts, never a health word): verified *n* of *m*, late, waiting for review, each a link to its Actions list. The header's actions are one **⋯** (`ProjectMenu`: Edit details, Watch, Start closing or Ask the firm to close while there is no Closing tab). "What moved since your last visit" is one line above the tabs that opens on demand. Plan: Sources (the firm's assessments) first, then the recommendations with the finding each answers as one line, then the rule chips (`lib/plan-rules.ts`), which filter the plan in place with their counts, then findings no recommendation answers. An action row opens with its arrow to show the files sent and the last review decision (`PlanActions`). Requests and files: the requests first, then the files with **Add a file** (`AddFileDialog`), then for a client the assessments shared with them. People: the firm's staff, for a client reader the firm's consultants on the project, the client's people, the client's roles; removing someone is in the row's **⋯** (`RemoveFromProject`). |
| `LinkTabs` | Tabs that are links between pages, styled like the tab list: each tab keeps its own address and nothing goes in the sidebar. The client page's Overview, Departments and Structure (`ClientTabs`, firm side), Team and Expertise (`TeamTabs`, firm side), the client's People, Departments and Structure (`ClientPeopleTabs`), and the Clients page's two views (all clients, client groups). Use shadcn `Tabs` for panels on one page (the project page: `ProjectMenu` row above), `LinkTabs` for pages. The tab row goes first, under the back link and above `PageHeader`, on every page it links, so it stays in place when you switch tabs and the page's own action ("Download PDF", the Excel export) sits under it and plainly belongs to that tab. A tab appears only when its page has something for the reader (the Structure tab once there is a structure to read), and a single tab draws no tab row. On the client's People page (page audit 4.1: the client's Departments are a tab of People, not a sidebar row), a manager gets the Departments tab only when the company uses departments (she reads them with their heads), and the Structure once there is one; when departments are off and there is a Structure, `/departments` takes her to it. The client admin keeps the Departments tab, because the switch that turns departments on lives there (`clientPeopleTabs()` in `lib/people-tabs.ts`; `departmentTabs()` in `lib/org-chart.ts` still decides where `/departments` sends a reader). A filter of one list that keeps its address (the Projects kind: all, client, internal) uses the same `LinkTabs` under `PageHeader`, since the page and its header stay the same. |
| `StructureBody`, `StructurePdfButton` (`components/org-chart/`) | The organisation structure, read only: the version shown and the day it took effect, the other versions as links, the levels control (links, so the page stays server-rendered), and the drawing; "Download PDF" as an outline button that opens one dialog (paper, levels, with or without names; one solid Download). The drawing is `orgTreeHtml()` (`lib/org-chart-html.ts`): nested lists with connector lines in CSS and logical properties, the same escaped HTML as the PDF, coloured from the tokens on screen (`var(--border)`, `var(--surface)`...) and from print greys in the PDF. Grey unit cards, the head position first in bold, "Vacant" as a dashed pill, advisory units with a dashed card on a dotted line beside their parent. No counts, scores or colours that judge a structure. |
| `OutlineEditor`, `HoldersPanel`, `PeopleView`, `OrgTreeView` (`components/org-chart/`) | Editing the organisation structure (part 3). `OutlineEditor` is the firm's draft as an indented list (nested lists, `border-s` guides, logical padding): each row shows its code (`dir="ltr"`), its name as a button that opens the side panel, quiet outline badges (kind, advisory, head, planned people, the linked department as a label), and a ⋯ menu with add, move up and down, indent, outdent, move under another unit and remove (a remove that cannot happen yet is disabled and says why). No drag and drop: Alt with the arrows moves the focused row, the side arrows following the reading direction, and the menu shows the shortcut; focus returns to the moved row. "Add unit" is solid only on an empty draft; rare actions ("Start again from the current version") go in the header's ⋯ menu behind `useConfirm`. The details open in a `Sheet` from the reading direction's end (the left in Arabic), with no corner close button (Cancel in the footer; Escape closes). In the draft, who holds a position is read only (today's holders of a position also on the published structure, and a link to "People in positions"): holders never change from the draft. `HoldersPanel` lists who holds a position with dates, places someone (a person picked, or a typed name, from a day), ends a holding, and removes one entered by mistake only after `useConfirm` says it cannot be undone. `PeopleView` is the current version's "People in positions": the vacant positions first, then a table of every position, each "Change" opening the holders panel in a sheet. `OrgTreeView` draws `orgTreeHtml(…, { people: true })`: a holder with an account is a native button (keyboard and screen reader ready, `aria-haspopup="dialog"`) that opens the work card, a dialog that lists the person's work as links and never a score, count or colour about the person. |
| `HomeSection`, `HomeRow` (`components/home/`) | A list on the home page (page audit 4.2 and section 7, item 9): a `SectionHeader` with the number of its rows, five rows, then "Show all" (`?all=<section>`), which opens the same list in full on the same page so the number and the list never disagree; not drawn when empty. A row is the item's title as a link, where it belongs, a few facts, and its next step as one outline link ("Answer", "Send a file", "Review", "Decide"): never a solid button. The order and grouping rules are in `lib/home.ts`. |
| `FileTree` (`components/ui/file-tree.tsx`) | AI Elements File Tree, adapted: monochrome icons, logical spacing, a chevron that flips in RTL, and a `meta` slot for counts and version badges. Use it for any folder-like list. |

### Icons

- **Animate UI first.** If `components/animate-ui/icons/<name>.tsx` exists, import it from there; otherwise use `lucide-react`. Animate UI icons are lucide glyphs, so the two mix without looking different.
- Use the current lucide names (`CircleCheck`, not `CheckCircle2`; `Ellipsis`, not `MoreHorizontal`).
- Animate an icon only where motion means something: `animateOnView` on an empty state, `animateOnHover` on a primary action, or `animate` while something is running. Never loop decorative icons.
- Sizes: `size-4` by default (buttons and menus size their icons automatically), `size-3` or `size-3.5` inside badges and dense rows, `size-5` in summary cards. Animate UI icons default to 28 px, so outside a `Button`, menu item or `EmptyMedia` always give them a `size-*` class.
- Arrows that point "back" or "forward" must flip in RTL: `className="rtl:-scale-x-100"` on lucide arrows, or pick `ArrowLeft`/`ArrowRight` by direction for Animate UI arrows (their motion transform overrides a CSS flip).
- An icon-only button needs `aria-label` and `title`.

---

Where every state of every kind of thing shows, under which word and with which one "yes" verb: [placement.md](placement.md) (October review, item 1).

---

## 2. Layout and dimensions

### Supported sizes

| | Width | Notes |
|---|---|---|
| Tablet | 768 to 1023 px (`md:`) | The sidebar can collapse to its icon rail; two-column pages stack until `lg:`. |
| Desktop | 1024 px and up (`lg:`) | The main design target. |
| Phone | below 768 px | Not designed for. Don't add `sm:`-only layouts for it. |

Use `md:` and `lg:` breakpoints for layout changes. `sm:` is fine inside shadcn components that already use it, not for page layout.

### The app shell (every signed-in page)

| Part | Size | Rule |
|---|---|---|
| Sidebar | `16rem` open, icon rail when collapsed | shadcn `sidebar-07`. On the right in Arabic, on the left in English. Wordmark when open, S mark when collapsed. Never shows its own scrollbar (it fits a 768 px window; below that it still scrolls by wheel or keys). |
| Top bar | `3rem` high, sticky, `border-b`, `bg-background/80` with blur | Sidebar trigger, the product tagline, notifications at the far end. Nothing page-specific goes here. |
| Main area | `max-w-6xl` (72 rem), centred, padding `p-4` (tablet) / `p-6` (desktop) | Set once in `app/(app)/layout.tsx`. Pages never add their own outer width or padding. |
| Top bar actions | Language button (EN / عربي), theme switch, then notifications, at the far end | `LocaleToggle` (sets `selah_locale` and re-renders the same page) and `ThemeSwitch` (Animate UI Theme Toggler Button driving the Theme Toggler wipe, which runs from the reading direction's start). |
| Vertical rhythm | `gap-6` between page blocks | Set by `template.tsx`; the page transition is in the layout (section 8). |

### Page anatomy

Every app page is, top to bottom:

1. Optional back link (`text-sm text-muted-foreground`, arrow icon, flips in RTL), only on detail pages.
2. `PageHeader` (title, optional description, `meta` badges, actions).
3. Optional page-level notice (`Alert`, or a muted banner for "internal project"-type context).
4. Content, using one of the patterns below.

### Content patterns

| Pattern | Grid | Used on |
|---|---|---|
| List page | One full-width table or card grid | Projects, clients, inquiries, actions, templates, notifications |
| Summary row | `grid grid-cols-2 gap-4 lg:grid-cols-4` of summary cards or `StatTile`s | Team totals, project progress, reports |
| Detail with side panel | `grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]` (main first in source order; `minmax(0,…)` keeps long titles and tables from pushing the page wider than a tablet) | Action, meeting, inquiry, template list. The client page uses `22rem` because its side panel holds the team. |
| Headline plus chart | `grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]` | Project progress, reports |
| Tabs | shadcn `Tabs` under the header, one panel per tab; `LinkTabs` above the header when each tab is its own page | Project page; the client page (Overview, Departments, Structure), Team and Expertise, the client's People, Departments and Structure, Clients and client groups |
| Card grid | `grid gap-4 md:grid-cols-2 xl:grid-cols-3` | Projects |
| Settings | Stack of form cards, one per topic, each with its own Save | Firm settings |

The side panel holds facts about the subject (project, owner, due date, client) as a definition list; the main column holds the work (next step, evidence, history).

### Readable measure

Long text (descriptions, AI answers, summaries, policy text) stays within `max-w-3xl`. Short helper text in a form stays within `max-w-sm` to `max-w-lg`.

### Dialogs and sheets

| Kind | Width | Height |
|---|---|---|
| Confirmation (`useConfirm`) | shadcn default (`max-w-lg`) | Content height |
| Short form (`FormDialog`) | Default `max-w-lg` | Content height |
| Long form (meeting, question editor, recommendation, action) | `sm:max-w-xl` or `sm:max-w-2xl` | `max-h-[85vh] overflow-y-auto` |
| Document preview or summary | `sm:max-w-2xl` | `max-h-[85vh]` |

Use `85vh` for every tall dialog. Footer buttons: primary action last in reading order (shadcn's `DialogFooter` handles the placement).

---

## 3. Spacing

Use the Tailwind 4 px scale. These are the values in use; pick from them rather than inventing new ones.

| Where | Value |
|---|---|
| Between page blocks | `gap-6` (from the layout) |
| Between cards in a grid, and in a summary row | `gap-4` |
| Inside a section (heading to content) | `space-y-3` or `space-y-4` |
| Card | `gap-3` or `gap-4`, `py-5`, header and content `px-5` |
| Dense card (a single line or a small list) | `gap-3 py-4` |
| Inside a form | `gap-4` between fields, `gap-2` between label and input |
| Inline items (badges, buttons in a row) | `gap-2` |
| Table cells | shadcn defaults (`px-2`, row height about 52 px with two-line cells) |

---

## 4. Type scale

One font: **IBM Plex Sans Arabic** (400, 500, 600) for both Arabic and Latin. Never use weights above 600 or below 400.

| Role | Classes | Size |
|---|---|---|
| Page title (`h1`, `PageHeader`) | `text-xl font-semibold tracking-tight` | 20 px |
| Section heading (`h2`, `SectionHeader`) | `text-base font-semibold` | 16 px |
| Card title | `CardTitle className="text-base"` | 16 px |
| Body | `text-sm` | 14 px |
| Secondary text, descriptions | `text-sm text-muted-foreground` | 14 px |
| Labels, meta, table sub-lines, badges | `text-xs` (muted where secondary) | 12 px |
| Stat value (`StatTile`, inline stats) | `text-2xl font-semibold tabular-nums` | 24 px |
| Summary card value (summary cards) | `text-3xl font-semibold tabular-nums` | 30 px |
| Headline metric (one per page at most) | `text-4xl font-semibold tabular-nums` | 36 px |
| Public page hero (`/inquiry`) | `text-3xl lg:text-4xl font-semibold tracking-tight text-balance` | 30 to 36 px |

Rules:

- 12 px is the smallest text. The only exceptions are avatar initials and the unread count bubble (10 px), which are not meant to be read as text.
- Numbers that change or line up get `tabular-nums`.
- Don't bold whole sentences; use `font-medium` for names and row titles, `font-semibold` only for headings and values.

---

## 5. Colour and contrast

### 5.1 Tokens

All colour comes from the CSS variables in `app/globals.css`. Never use Tailwind palette colours (`text-red-600`, `bg-emerald-50`...), hex values or `oklch()` in components.

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | 0.97 | 0.13 | Page. A light grey (light) or near black (dark), never the same as a card, so cards don't melt into the page. |
| `card` / `popover` | 1.0 | 0.195 / 0.215 | Raised surfaces: content cards, tables, dialogs, menus |
| `surface` | 0.93 | 0.255 | The grey card: summary numbers (`StatTile`, the home's line of counts, their skeletons) and highlights inside a white card. Use `bg-surface text-surface-foreground`. |
| `foreground` | 0.18 | 0.95 | Text |
| `muted-foreground` | 0.5 | 0.70 | Secondary text, icons |
| `muted`, `accent`, `secondary` | 0.94 to 0.95 | 0.245 to 0.27 | Quiet fills, hover |
| `primary` | 0.2 (near black) | 0.93 (near white) | The one strong colour: primary buttons, active states, the "new" badge |
| `border` | 0.905 | white 10% | Card, table and divider lines |
| `input` | 0.885 | white 14% | Button and tab outlines, switch track |
| `field` | 0.62 | white 35% | Borders of text inputs, selects, checkboxes, radios |
| `destructive` | red, low chroma | | Problems: blocked, revision requested, overdue, errors |
| `warning` | amber, low chroma | | Waiting on someone |
| `success` | green, low chroma | | Human-verified only |

(Values are OKLCH lightness; all neutrals have zero chroma.)

**Which surface where.** The page is grey and content cards are white (light theme), or the page is near black and cards a lighter charcoal (dark theme), so a card always reads as a card. Summary numbers sit on the darker `surface` grey, which breaks up a page of white cards (or of black ones) without adding colour. Don't put form fields on `surface`: their border drops under 3:1 there.

**Floating surfaces.** The Files card adds the `surface-floating` class, which redefines the tokens above inside it to one charcoal grey that is the same in both themes (`popover` 0.3, `card` 0.355, `muted` 0.255, `accent` 0.42, `foreground` 0.97, `muted-foreground` 0.8, `border` white 16%). The card then stands out from the light page and from the near-black dark page alike, and everything inside it (buttons, badges, fields) stays readable without per-component colours. Use it only for floating, movable panels. Dialogs and menus opened from inside are portalled out and keep the normal theme.

### 5.2 Measured contrast (WCAG 2.2 AA)

AA needs 4.5:1 for text, 3:1 for large text and for the boundaries of form controls. Measured from the tokens:

| Pair | Light | Dark |
|---|---|---|
| `foreground` on `background` | 17.2 | 17.4 |
| `muted-foreground` on `background` | 5.5 | 7.5 |
| `muted-foreground` on `muted` | 5.2 | 6.1 |
| `foreground` on `surface` | 15.3 | 13.6 |
| `muted-foreground` on `surface` | 4.9 | 5.9 |
| `destructive` text on `card` | 5.9 | 5.2 |
| `destructive` text on `destructive/10` | 5.1 | 4.7 |
| `success` text on `success/15` | 4.7 | 5.7 |
| `foreground` on `warning/15` | 16.0 | 12.4 |
| `warning` text on `card` | 4.9 | 8.6 |
| `field` border on `background` | 3.3 | 3.1 |

Inside `surface-floating` (same in both themes): `foreground` on `popover` 12.5, `muted-foreground` on `popover` 7.3, on `card` 5.9, on `accent` 4.5; `destructive` text on `card` 5.1; `field` border on `card` 6.0.

Rules that keep it that way:

- Text is `foreground` or `muted-foreground`. Don't lower contrast with opacity (`text-foreground/60`) on text people need to read; `opacity-60` is only for clearly superseded items (an old signed acceptance) that also carry a label.
- Status text uses its tone at full strength on its own tint (`text-destructive` on `bg-destructive/10`). Amber is a background tint only, with `text-foreground` on it; `text-warning` is allowed for small icons and markers, which meet 4.5:1 since the token change.
- Never use colour alone: every status badge carries a word, and overdue dates add "(overdue)".
- Focus rings come from shadcn (`ring-ring/50`, 3 px). Don't remove `outline` or `ring` styles.
- After changing a token, recheck these pairs (a short OKLCH-to-sRGB script is enough) and update the table.

### 5.3 Status tones

Every coloured badge goes through `ToneBadge` (`components/tone-badge.tsx`), so a status looks the same on every screen:

| Tone | Look | Meaning | Examples |
|---|---|---|---|
| `open` | Outline, no fill | Exists and is not settled; nothing is wrong | Scheduled meeting, inquiry being triaged |
| `neutral` | Grey fill, muted text | Settled, inactive or plain fact | Assigned, closed, draft, conflict check clear |
| `active` | Light grey fill | Someone is working on it | In progress |
| `waiting` | Amber tint, dark text | Waiting on someone else | Awaiting review, pending join request |
| `problem` | Red tint, red text | Needs attention | Blocked, revision requested, cancelled, conflict flagged |
| `verified` | Green tint, green text | **Human-verified only** | Verified complete |
| `new` | Solid primary | Unread or untouched | New inquiry |

Green never means "the client said it's done". A completion claim is `active` or `waiting` until a consultant verifies it.

Plain `Badge` variants are for labels that are not statuses: `outline` for kind and category labels (meeting kind, legal form, priority), `secondary` for "shared" or "settled" facts (shared report, 2FA on), `default` for the one selected item in a set (current template version). Don't use the solid `destructive` badge variant; it is louder than the monochrome UI allows.

---

## 6. Shape and elevation

| Element | Radius | Shadow |
|---|---|---|
| Page-level surfaces: `Card`, table wrappers, list panels, `StatTile`, empty states | `rounded-xl` | `shadow-xs` |
| Nested boxes inside a card: fieldsets, sub-lists, inline forms, notices | `rounded-lg` | none |
| Small chips, file pills, inputs, buttons | `rounded-md` (shadcn default) | shadcn default |
| Badges, avatars, toggles | `rounded-full` | none |
| Popovers, menus, dialogs | shadcn defaults | shadcn defaults |

- Cards always pass `shadow-xs` (shadcn's default `shadow-sm` is heavier than the rest of the app). The public inquiry form card is the one exception.
- A table that is the main content of a page sits in `overflow-hidden rounded-xl border bg-card`.
- Hover lift (`-translate-y-0.5`, stronger border) is only for whole cards that are links (project cards).

---

## 7. Components

### Buttons

| Variant | Use |
|---|---|
| `default` (solid) | The one main action in a region: Save, Invite, Submit evidence. At most one per card or dialog. |
| `outline` | Secondary actions in headers and cards. |
| `ghost` | Low-weight actions inside rows (remove, show more) and icon buttons. |
| `destructive` | Irreversible removal, always behind `useConfirm`. |
| `secondary` | Rare; toggles that read as "on". |

Sizes: `sm` in page headers, cards and tables; `default` in dialogs and forms; `icon` with `size-7` for row actions. A busy button shows `BrandLoader` in place of its icon and is disabled.

**Dense rows** (page audit U15). A row or a card in a list shows at most one button of its own: its main step, outline or ghost (accepting a requested file, sending one, adding a person to a department). Every other action of that row (edit, rename, return, "does not apply", send or stop an upload link, make head or lead or deputy, remove) goes in a `RowMenu` at the row's end. A row whose actions are all rare shows only the menu (an indicator value: mark checked, correct; a person in a department; a consultant on the client page). The same holds for a page header: one main button, the rest in one menu beside it (the indicator page: "Enter a value", then a menu with edit, switch off or on, mail, delete). In use on document request rows, department cards and their people, indicator value rows, and the consultants and contacts on the firm's client page.

### Forms

- shadcn `Field`/`Label` with the input below; helper text `text-xs text-muted-foreground` under the input; errors `text-xs text-destructive` with `aria-invalid` on the input.
- Required fields are marked in the label, not by colour.
- Emails, URLs, codes and numbers are `dir="ltr"` even in Arabic.
- Dates use `DatePicker` (react-day-picker), never a bare `<input type="date">`.
- Confirm success with a toast (`toast.success` from `components/ui/toast`: Animate UI's toast on Base UI, at the end corner of the reading direction); show failures inline next to the action.
- A `Switch` inside a form sits in `<span className="relative [&>input]:!start-0 [&>input]:![transform:none]">`: Radix renders a hidden input that otherwise overflows the page in RTL.
- Creating plan records (finding, recommendation, action) happens where they are read: the project's Plan, with one solid **Add a recommendation** in the recommendations' `SectionHeader` and a **⋯** beside it for the rarer ways in (Add a finding, Import, Download as Excel; `PlanAdd`). A recommendation card offers **Add an action**, and so does the recommendation's own page; a finding no recommendation answers yet offers **Add a recommendation for it**, the finding preselected.
- The recommendation dialog shows five fields (title, priority, accountable, due date, rationale) and keeps the rest behind **More fields** (the finding it answers, the source, the department, the target outcome, the evidence, who sees it; October review, item 5; `lib/plan-fields.ts`). The folded fields stay in the form, so a correction keeps what they hold, and **More fields** opens by itself when one of them already holds something.

### Tables

- shadcn `Table` in a page-level wrapper (section 6). First column is the row's name in `font-medium`, with an optional `text-xs text-muted-foreground` sub-line.
- Numbers and dates are `tabular-nums`; numeric columns align to the end.
- Status goes in its own column, as a `StatusBadge` or `ToneBadge`.
- Empty tables show `EmptyState` (or the table's own empty row for `ActionsTable`), never a blank box.

### Empty, loading and error states

- Empty: `EmptyState` with an Animate UI icon (`animateOnView`) and one sentence that says what will appear and, if possible, the action that creates it. Where the reader may not open everything there (a limited manager, an action owner, a client reader), the sentence says "none for you yet" («لا اجتماعات لك بعد»), not "none yet", and never hints at what is hidden.
- Loading: every route segment that fetches data has a `loading.tsx` built from `page-skeletons` that mirrors the real layout.
- Errors: inline `text-destructive` next to the control that failed, or a toast for background actions. Messages come from `messages/*.json`, never raw API errors.

### Notices

- `Alert` for page-level states that change what the person should do (overdue work, consent needed).
- A muted banner (`rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground` with an icon) for standing context such as "internal project, firm only".

### AI output

AI-written text is always labelled as such, shows its sources, and never uses the `verified` tone. Uncertainty is shown with the `waiting` tone and a plain sentence.

---

## 8. Motion

- Use the shared tokens in `globals.css`: `--duration-fast` (150 ms), `--duration-base` (240 ms), `--duration-slow` (340 ms), `--ease-out-soft`, `--ease-in-out-soft`. Don't hard-code other timings.
- **Page transitions.** `app/(app)/layout.tsx` wraps the page in Animate UI's `PageTransition` with the `fade` effect: the old page leaves in 0.15 s and the new one arrives in 0.3 s through a light blur, while the sidebar and top bar stay still. Fade was chosen over the sliding effects because most moves in Selah are sideways jumps through the sidebar, not a stack of screens, and a short fade never fights the morphs below. Don't wrap single pages in their own transition and don't add per-page entrance animations; lists can still use `.stagger`. Skeletons shimmer. The floating cards (Files, the assistant) carry their own view-transition names (`.floating-card-files`, `.floating-card-assistant` in globals.css) and sit above the page and the morphing titles during a transition; a new floating card needs the same.
- **Morphs (shared elements).** A title that appears on a list and on the page it opens carries the same name in both places, and the transition morphs one into the other: `PageHeader morph="project-<id>"` on the detail page, and `<MorphTitle name="project-<id>">` around the title on the card or row that links to it (`components/morph.tsx`). Names in use: `project-`, `client-`, `group-`, `rec-`, `action-`. A name may appear only once on a page (the browser drops the whole transition otherwise), so never morph a value that repeats, such as the project column of an actions table. The loading skeleton shows the clicked title under the same name, so the title moves into place before the page's data arrives.
- Under reduced motion, `globals.css` removes every view-transition animation, so pages and themes swap at once with no fade, morph or wipe.
- Numbers count with `AnimatedNumber`; icons animate per section 1.
- `prefers-reduced-motion` turns all of it off globally. Don't add motion that bypasses that rule (for example JavaScript loops that ignore it).

### Animate UI components and where they live

Each component from the Animate UI list has one job in Selah. Reuse these places; don't scatter the same effect elsewhere.

| Component | Where | Why there |
|---|---|---|
| Page Transition | `app/(app)/layout.tsx` | Every page change (section 8 above). |
| Theme Toggler + Theme Toggler Button | Top bar (`ThemeSwitch`) | One-click light/dark with a wipe from the reading direction's start. |
| Typing Text, Highlight Text, Blur, Highlight | `Welcome` on the home page, for two weeks after a person's first sign-in | The greeting types itself, the line under it highlights what Selah is for, and three role-specific places to start blur in with a hover highlight. Dismissible per browser. The inquiry confirmation also highlights the reference code. |
| Counting Number | `AnimatedNumber` (summary cards, tiles) | Numbers arriving on a page. |
| Sliding Number | Unread count on the bell; the project's "implemented" headline | Numbers that change while you watch, or the one headline per page. |
| Scroll Fade | Notifications popover | Fades the edges of the list where there is more to scroll. |
| Scroll Progress | `ReadingProgress` on the legal notices (the inquiry form's privacy notice is one of them) | Long documents read top to bottom. |
| Auto Height | `FormDialog` error line | The footer slides down when an error appears. |
| Particles | `VerifiedBurst` on the action page's status badge | One small green burst right after a consultant accepts the evidence (human verification is the moment worth marking). Never on later visits. |
| Tilt | Project cards on `/projects` | Cards that are whole links lean slightly (3°) toward the pointer. |
| Motion Grid | `ExportButton` busy state | A 3×3 ripple while the export is made. |
| Copy Button | `CopyButton`: inquiry reference, 2FA backup codes | The icon turns into a check after copying. |
| Button | `ui/button.tsx` | Every button springs to 97% on press. |
| Pagination | `ListPager` | The current-page highlight slides to the chosen page. |
| Toast | `ui/toast.tsx` (Base UI) | Every confirmation. |
| Accordion, Alert Dialog, Checkbox, Collapsible, Dialog, Dropdown Menu, Hover Card, Popover, Progress, Radio Group, Select, Sheet, Switch, Tabs, Toggle, Toggle Group, Tooltip | `components/ui/*` on `@animate-ui/react/primitives/radix-ui` | Same API as shadcn; Motion drives their entrances. Keep new shadcn components on these primitives (`npx @animate-ui/cli animate <name>`). |
| Combobox | `components/ui/combobox.tsx` on `@animate-ui/react/primitives/base-ui`; `components/person-picker.tsx` and `components/audience-picker.tsx` on top | Every pick of one person from a list that can grow (consultants, staff, client people, owners, assignees, attendees): type part of a name or email. In a form dialog use field type `person`. Several people at once are chips: `multiple` with `ComboboxChips`, a `ComboboxChip` per pick (with `ComboboxChipRemove`, or `removable={false}` for one that must stay) and `ComboboxChipsInput`; chips pop in and out (Animate UI), Backspace in the empty field removes the last chip, the arrow keys move between chips in the reading direction, Backspace or Delete removes the focused one, Enter picks. Long lists split into `ComboboxGroup`s with a `ComboboxGroupLabel`. Short fixed lists (roles, yes/no, a handful of choices) stay on Select. Inside a Radix dialog the list portals into the picker's own element so the dialog's focus trap lets it be clicked; keep that element outside anything that clips (a collapsible panel). |
| Topography | Sign-in, invite, upload link pages | Background of signed-out pages. |
| Lucide icons | `components/animate-ui/icons` | See section 1. |

Not used, on purpose: **Hugeicons** (a second icon family would break the single lucide style), **Scrolling Number** (an odometer strip; Selah has no picker or counter that needs one, Sliding Number covers changing numbers), **Pinned List** (needs a "pin a project" feature that doesn't exist), **Preview Link Card** (Selah links to its own pages, there are no external pages to preview), **Drawer** and **Sheet-style mobile panels** (no phone layouts), **Menubar** and **Navigation Menu** (the sidebar is the navigation; a second menu would crowd the shell), **Avatar Group** (the Clients list names the lead and counts the others, October review item 3; initials in a stack read as nothing), **Slider** (every number in Selah needs an exact value), **Questionnaire** (the inquiry form is already a step-by-step form), **Sidebar** (Selah keeps the shadcn `sidebar-07` shell, which already animates).

---

## 9. RTL and LTR

- Arabic is the default locale. `<html dir>` follows the locale; never hard-code `dir="rtl"` on a page.
- Use logical utilities only: `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s`/`rounded-e`. Physical ones (`ml-`, `pr-`, `left-`, `text-right`...) are not allowed outside `components/ui`.
- Directional icons flip (section 1). Progress bars fill from the start (`Meter`).
- Mixed text: Latin strings inside Arabic (emails, IDs, file names) get `dir="ltr"` or `<bdi>`; Arabic names inside English need nothing extra.
- Join lists with the locale's comma (`،` in Arabic).
- Dates and numbers go through `next-intl` formatters, never string concatenation.
- Check every new screen in Arabic light and English dark before merging.

---

## 10. Firm and consultant side

Who: firm admin, consultants (and the lead consultant per client).

**Purpose of the UI:** oversight and decisions. Dense, scannable, and explicit about what is firm-only.

- **Navigation** (page audit 4.1, `sidebarFor()` in `lib/nav.ts`, tested in `tests/navigation.test.ts`): one sidebar per role, no sub-entries. Firm admin: Home, Projects, Clients, Actions, Inquiries, Assistant, then Organisation: Team, Assessment templates, Audit log; Files at the foot. A consultant: Home, Projects, Clients, Actions, Assistant, and only when they apply Inquiries (while one is assigned to them), Team (for a consultant who leads or deputises for a client) and Assessment templates (for a named author). What the sub-entries were lives on the pages: the kind filter on Projects, client groups as the second view of Clients (`/clients?view=groups`; `/clients/groups` redirects there, and "Enter an inquiry" sits beside "Start a pitch"), Expertise as a tab of Team. Actions is one page with its lists as filters (`/actions?filter=…`); `/review` and `/oversight` redirect there, and the row stays marked on every filtered address. Oversight's per-project columns are the Projects table (`/projects?view=table`), which the kind filter keeps. Home points to `/`.
- **User menu** (`userMenuFor()`): Settings (firm admin) or My expertise (a consultant's own line of the Expertise tab), Mail options (`/notifications/mail`, with the muted actions and indicators), Two-factor sign-in, Sign out. Language and theme are not in it: they are in the top bar only (October review item 6). The sidebar must fit a 768 px tall window without scrolling: add a new page as a tab of an existing page before adding a row.
- **Home** (`/`, «الرئيسية»; it replaced Overview and Today, decision D2): what waits for the reader first, in the order of page audit 4.2: the decisions waiting for them (and, for the firm admin, the messages from clients and the new inquiries), the evidence they may review, late or due this week, their follow-ups, their meetings this week, what changed since their last visit. The firm admin's page says its late work and reviews cover the clients she follows. Then one line of counts on the `surface` grey (late, awaiting review, reviews waiting over 7 days, blocked), each a link to its Actions filter: counts, never a health word (D5).
- **Density:** tables over cards for lists; side panels on detail pages; five tabs on the project page (Plan, Requests and files, Meetings, Progress, People, and Closing while needed). The Trace tab and the Needs attention tab are gone (decision D2): the rules are chips on Plan, and an action row on Plan opens to show its evidence and review result.
- **Firm-only content must look firm-only.** Anything a client cannot see (internal projects, private notes and firm notes on actions, firm-only findings and recommendations, scores, firm-only reports and assessments) carries a `Lock` icon or a "Firm only" badge, and internal projects show the muted banner. Scores are firm-only and never appear on client screens.
- **Decisions are explicit:** review actions (accept, request revision, waive) are buttons with a clear outcome, behind a dialog when they need a reason. Nothing changes status silently.
- **People data:** workload is "sorted by name, for allocation, not a rating". Never rank people or colour them by performance.
- **Consultant-managed clients:** screens that record work on the client's behalf say so (the record source is shown).

---

## 11. Client side

Who: client admin, client manager, action owner.

**Purpose of the UI:** know what is asked of you, do it, and prove it. Fewer choices, plainer words.

- **Navigation** (page audit 4.1, `sidebarFor()` in `lib/nav.ts`): client admin: Home, Projects, Actions, the Assistant as soon as the firm offers it (before consent it opens the consent view, `/assistant/consent`; once on, the card), then Company: People, Our group (only when the firm granted it), Audit log. Client manager: Home, Projects, Actions, the Assistant only when it is on, and People, read only. People (`/team`) has the Departments and Structure as tabs (`ClientPeopleTabs`), so the old Team and Departments rows are one. Action owner: My actions (the home, `/`) and Projects. Help and Files at the foot for every client role. No firm tools (inquiries, templates, review queue) appear. Help (`/help`, F13) is always in the same place for every client role: at the foot of the sidebar above Files, and in the user menu (WCAG 2.2, 3.2.6 consistent help).
- **User menu**: Mail options, Two-factor sign-in, Help, Sign out for every client role; the client admin also has Data sharing (`/indicators/data`) and, once the firm offered the assistant, Assistant consent (what was agreed, by whom and when, and the switch to withdraw).
- **Help** holds three things and is not a second home page (page audit U17): your consultants in one list (the lead, the deputy, then the others with their projects and work addresses, and how to reach them), "Write to the firm's management" (the only solid button on the page is its Send; only the firm's admins read it), and the common questions. No first steps and no list of the person's actions: those are on the home and Actions pages.
- **Home** (`/`, «الرئيسية»): for the client admin and managers, what waits for them first (recommendations waiting for the company's answer, documents asked of them, files sent back, their late or stopped actions, answers to the dates they proposed, meetings to reply to and the next one, their follow-ups, indicator values due, deliverables to confirm; for the admin the assistant offer and the data-sharing choice as one row each until answered), then the progress table with the report PDF, the indicators card (its "New indicator" an outline button there) and, for the people the firm named, the group roll-up. For an action owner, their own actions in three groups (waiting for them, with the consultant, finished and folded), then the files asked of them, their meetings and follow-ups; nothing else.
- **Action page first** (page audit 4.5, batch 4): one page for the owner, the manager and the reviewer, in the same order; what differs is the first card. 1 the header: the title, the state, the due date with the late flag, and one **⋯** (`ActionPageMenu`: close, reopen, the company accepts the risk, mail; only what the server allows). 2 what happened last, one muted box each, only when it applies: the reason it was sent back, the closing note, "this action was given to you", on a client the firm runs "recorded by the firm for the client". 3 the next step (`ActionPanel`, from `nextStep()` in `lib/action-next.ts`): one solid button per state (Start work · Send for review · Send the revised file for review, in one step · Resume work, under the reason; for the reviewer Verify, or the first or second sign-off, with **Send back** as an outline and the files being judged in the same card; a date to decide as Accept the new date / Decline), or one line saying who it is with ("With the consultant since …", "With the client", "Another consultant reviews this: …", or that nobody else on the project can review it: N25); under it three quiet links, **I am stuck · I need more time · Ask the consultant**, each only where the server allows it. When every evidence item has its file, Verify also accepts the files still to check, in one step, unless the work needs two sign-offs (October review, item 12). 4 **What to send** (`WhatToSend`): the description, what shows it is done, and the evidence list as `RequestRow`s, each with one outline **Send a file**. 5 one file dialog (`SendFileDialog`). 6 one conversation (`CommentThread`): the discussion and the progress notes in one list and one box; whoever moves the work may mark what they write as an update on the work, and on a client the firm runs the firm records the client's progress there with how and when it came. On a finished action a client reader gets no box. 7 the history: files and decisions, and who it was given to. 8 the side panel: project, recommendation, owner (with **Give to a colleague** for those decision D1 allows: `OwnerChange`), department; for the firm also the date record, reminders (not on a client the firm runs: it has none of the roles they name, N24), second sign-off and firm notes.
- **The firm's machinery is not drawn for a client reader** (page audit 4.5; `actionPageCards()` in `lib/action-plain.ts`): no reminder ladder, no date history or slip sentence, no sign-off count (nor the first sign-off in the history). Two plain lines under the next step take their place (`PlainDateLines`): what is expected next and by when ("Due 5 Jan", or "It is late: it was due 5 Jan", then who is told next and on which day, in the reader's words: "your company's managers", "the project's sponsor"), and what last happened to the date (a proposal waiting, the new date and who agreed it, a proposal declined). A new date is proposed from the quiet link **I need more time** under them. Rare things sit in the page's **⋯** menu (`ActionMenu`): mute mail, and accepting the risk of not finishing it (client admins and managers); a signed acceptance shows as a record card, never as a standing button. The server rules do not change: the firm's page keeps every card.
- **Progress tab for a client reader** (`lib/progress-parts.ts`): the share verified, how the actions ended and the reports the firm shared, with one line saying so. The firm's working measures (median wait, on-time rate, date moves, revisions, what verification rests on, late against the original date, the monthly trend) and the handover card are the firm's.
- **Meeting page, both sides** (`meetingSections()` in `lib/meetings.ts`): before the meeting it holds what a person needs to attend: the time, the call link or the place, **Add to calendar**, the agenda, who is invited, and the reader's own answer in their own voice (**I'll attend · Maybe · I can't attend**, the chosen one drawn as `secondary`, so the call link stays the card's one solid button). The summary, decisions, follow-ups and the firm's transcript appear once it is held (a follow-up already written on a meeting not yet held stays listed). Cancelling is in the organiser's **⋯** menu. A client reader does not get the "Shared with the client" badge.
- **Language:** say what to do next ("Upload the signed charter"), not system states. Avoid firm jargon (triage, conflict check, RLS). Speak to the reader: "your company's answer", "your people on this project", never "the client". Where one message serves both sides, a `…Client` key holds the client's words (`hintClient`, `titleClient`) and the screen picks it by reader.
- **One word per thing** (page audit 4.7): the firm is «المكتب», never «الشركة» («الشركة» / «شركتكم» is the client's own company); an action's owner is «المكلَّف» (role «مكلَّف بالتنفيذ»), and «مسؤول» is kept for administrators; «متعثر» is a blocked action only (the Oversight label is «خارج المسار»); a file is sent two ways only, **إرسال ملف / Send a file** and **إرسال للمراجعة / Send for review**, both through the one dialog; a client proposes a new date («اقتراح موعد جديد»), and the Requests and files tab lists **المستندات المطلوبة / Documents requested**.
- **Project page for a client reader**: the same five tabs as the firm's; what differs is what each holds. Plan has the late and blocked chips only; Requests and files is where a client adds a file (the Files card in the sidebar only finds files for a client, October review, item 13) and reads the assessments the firm shared; People names the firm's consultants on the project (the same people Help lists). An action owner's Plan is their own actions under their recommendations, and they have no Progress tab.
- **Never show:** other clients, firm-only notes, assessment scores, internal projects, consultant workload, or AI features that are not enabled for client roles.
- **Shared items** (reports, files, meeting summaries) show who shared them and when.
- **Claims vs verification:** the client's own update is shown as a claim (`active` or `waiting`) until the firm verifies it; a client never sees green for their own unreviewed work.

---

## 12. Public and sign-in pages

- **Auth pages** (`app/(auth)`): centred `max-w-sm` card (`py-6 shadow-xs`) over the `Topography` background, wordmark above, `text-xl` title. Same tokens and components as the app.
- **Public pages** (`app/(public)`: `/inquiry`, `/legal/:doc`): `max-w-6xl` shell; the inquiry page is a two-column intro and form (`lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`), each legal document a single `max-w-3xl` text column with the other documents listed at its foot. The inquiry form's privacy notice is one of them (`/legal/inquiry-privacy`, with a way back to the form); the old address `/privacy` redirects there for good (`next.config.ts`). The inquiry page is the only one with a hero-sized title. Its form asks in four steps: the organisation and the person on one first step, what they need, the optional questions, and a review step that shows every answer. An upload link's page (`/upload/<token>`, F14) is one `max-w-xl` card over the `Topography` background: the requested item, the firm's name and the file field, nothing else. Its header (`PublicFrame bare`) has the language switch only: no sign-in button, and the wordmark is not a link.
- **Language switch on every signed-out page**: in the header on public pages, in the top corner at the end side on auth pages and the signed-out Not found (`CornerLocaleToggle`). It stays on the page it is on. A page inside the app shell never adds one: the top bar has it.
- **A dead mail link** says so when the page opens and offers one way on (`DeadLink` in `app/(auth)`).
- No client data, staff names or internal wording on public pages, in what is shown and in the page's source: a signed-out layout passes `NextIntlClientProvider` only the namespaces its pages read (`src/i18n/signed-out-messages.ts`, checked by `tests/signed-out-messages.test.ts`), never the whole catalogue.
- A link styled as a button in a server component is an `<a>` or `<Link>` with `buttonVariants(...)`, not `<Button asChild>`: that button's slot renders nothing while its child is still arriving from the server, which fails hydration.

---

## 13. Review checklist

Before merging a screen:

- [ ] Built from shadcn, Animate UI and the Selah components; any new component is documented here.
- [ ] `PageHeader` at the top; sections use `SectionHeader`; no outer width or padding added by the page.
- [ ] Type sizes, spacing, radius and shadows come from sections 3, 4 and 6.
- [ ] Colours are tokens only; statuses go through `ToneBadge`/`StatusBadge`; green only for human-verified work.
- [ ] Confirmations use `useConfirm`, not `window.confirm`.
- [ ] Logical (RTL-safe) classes only; checked in Arabic light and English dark.
- [ ] Works at 768 px and 1280 px wide.
- [ ] Has `loading.tsx`, an empty state and inline errors.
- [ ] Backed by a real API; no sample or demo labels.
- [ ] Firm-only content is marked, and nothing firm-only reaches a client role.

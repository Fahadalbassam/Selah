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
| `ActionsTable` | Any list of actions (title, project, owner, due date, status). |
| `ListPager` | Previous and next links under a long list, with "1–50 of 230". Hidden when everything fits on one page. Pages are a `?page=` link, so they survive a reload; read the value with `pageParam()`. |
| `ExportButton` | Downloads an export (Excel or PDF) from a GET route in the reader's language, with a busy state and an inline error (the PDF service being down is said plainly). |
| `FormDialog`, `ApiButton` | A dialog that posts a form, and a button that calls one API route. Both refresh the page and show errors in the person's language. |
| `useConfirm` | Every "are you sure?" step (shadcn `AlertDialog`). Never use `window.confirm`: it ignores the theme and the reading direction. |
| `page-skeletons` | `HeaderSkeleton`, `StatCardsSkeleton`, `TableSkeleton`, `CardGridSkeleton`, `CardSkeleton`, `DetailSkeleton` for `loading.tsx` files. Match the real page's layout. |
| `BrandMark`, `BrandWordmark`, `SidebarBrand`, `BrandLoader` | The logo and the branded spinner. Use `BrandLoader` inside busy buttons. |
| `Translatable` | User-written text that may be shown in the other language on demand. |
| `AnimatedNumber`, `MetricHistory`, `PeopleStack`, `Topography` | Counting numbers, the progress trend chart, stacked avatars, and the animated contour background. |
| `FilesSidebarItem`, `FileBrowser` | The file explorer: the animated folder at the bottom of the sidebar opens a floating card (not modal) with search, the file tree, the selected file's details and "Add a file". The card is dragged by its header or moved with the arrow keys when the header has focus, stays inside the window, remembers its position per browser, and closes with Escape. `FileBrowser` with `pick` is the same tree inside the evidence dialog, to reuse a file instead of uploading it again. |
| `FileTree` (`components/ui/file-tree.tsx`) | AI Elements File Tree, adapted: monochrome icons, logical spacing, a chevron that flips in RTL, and a `meta` slot for counts and version badges. Use it for any folder-like list. |

### Icons

- **Animate UI first.** If `components/animate-ui/icons/<name>.tsx` exists, import it from there; otherwise use `lucide-react`. Animate UI icons are lucide glyphs, so the two mix without looking different.
- Use the current lucide names (`CircleCheck`, not `CheckCircle2`; `Ellipsis`, not `MoreHorizontal`).
- Animate an icon only where motion means something: `animateOnView` on an empty state, `animateOnHover` on a primary action, or `animate` while something is running. Never loop decorative icons.
- Sizes: `size-4` by default (buttons and menus size their icons automatically), `size-3` or `size-3.5` inside badges and dense rows, `size-5` in summary cards. Animate UI icons default to 28 px, so outside a `Button`, menu item or `EmptyMedia` always give them a `size-*` class.
- Arrows that point "back" or "forward" must flip in RTL: `className="rtl:-scale-x-100"` on lucide arrows, or pick `ArrowLeft`/`ArrowRight` by direction for Animate UI arrows (their motion transform overrides a CSS flip).
- An icon-only button needs `aria-label` and `title`.

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
| Top bar | `3rem` | Sidebar toggle and tagline at the start; the language button (EN / عربي), the theme toggle and notifications at the end. |
| Top bar | `3rem` high, sticky, `border-b`, `bg-background/80` with blur | Sidebar trigger, the product tagline, notifications at the far end. Nothing page-specific goes here. |
| Main area | `max-w-6xl` (72 rem), centred, padding `p-4` (tablet) / `p-6` (desktop) | Set once in `app/(app)/layout.tsx`. Pages never add their own outer width or padding. |
| Top bar actions | Theme switch, then notifications, at the far end | `ThemeSwitch` (Animate UI Theme Toggler Button driving the Theme Toggler wipe, which runs from the reading direction's start). |
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
| Summary row | `grid grid-cols-2 gap-4 lg:grid-cols-4` of summary cards or `StatTile`s | Overview, team totals, project progress, reports |
| Detail with side panel | `grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]` (main first in source order; `minmax(0,…)` keeps long titles and tables from pushing the page wider than a tablet) | Action, meeting, inquiry, template list. The client page uses `22rem` because its side panel holds the team. |
| Headline plus chart | `grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]` | Project progress, reports |
| Tabs | shadcn `Tabs` under the header, one panel per tab | Project page |
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
| Summary card value (overview cards) | `text-3xl font-semibold tabular-nums` | 30 px |
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
| `surface` | 0.93 | 0.255 | The grey card: summary numbers (`StatTile`, the overview's four cards, their skeletons) and highlights inside a white card. Use `bg-surface text-surface-foreground`. |
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

### Forms

- shadcn `Field`/`Label` with the input below; helper text `text-xs text-muted-foreground` under the input; errors `text-xs text-destructive` with `aria-invalid` on the input.
- Required fields are marked in the label, not by colour.
- Emails, URLs, codes and numbers are `dir="ltr"` even in Arabic.
- Dates use `DatePicker` (react-day-picker), never a bare `<input type="date">`.
- Confirm success with a toast (`toast.success` from `components/ui/toast`: Animate UI's toast on Base UI, at the end corner of the reading direction); show failures inline next to the action.
- A `Switch` inside a form sits in `<span className="relative [&>input]:!start-0 [&>input]:![transform:none]">`: Radix renders a hidden input that otherwise overflows the page in RTL.
- Creating plan records (finding, recommendation, action) happens where they are read: the project's Recommendations tab, with the add button in the `SectionHeader` and on each row (a finding row offers "Add a recommendation" with the finding preselected; a recommendation card offers "Add an action").

### Tables

- shadcn `Table` in a page-level wrapper (section 6). First column is the row's name in `font-medium`, with an optional `text-xs text-muted-foreground` sub-line.
- Numbers and dates are `tabular-nums`; numeric columns align to the end.
- Status goes in its own column, as a `StatusBadge` or `ToneBadge`.
- Empty tables show `EmptyState` (or the table's own empty row for `ActionsTable`), never a blank box.

### Empty, loading and error states

- Empty: `EmptyState` with an Animate UI icon (`animateOnView`) and one sentence that says what will appear and, if possible, the action that creates it.
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
| Typing Text, Highlight Text, Blur, Highlight | `Welcome` on the overview, for two weeks after a person's first sign-in | The greeting types itself, the line under it highlights what Selah is for, and three role-specific places to start blur in with a hover highlight. Dismissible per browser. The inquiry confirmation also highlights the reference code. |
| Counting Number | `AnimatedNumber` (overview cards, tiles) | Numbers arriving on a page. |
| Sliding Number | Unread count on the bell; the project's "implemented" headline | Numbers that change while you watch, or the one headline per page. |
| Avatar Group | `PeopleStack` | Stacked people on cards and headers. |
| Scroll Fade | Notifications popover | Fades the edges of the list where there is more to scroll. |
| Scroll Progress | `ReadingProgress` on the legal notices and the privacy notice | Long documents read top to bottom. |
| Auto Height | `FormDialog` error line | The footer slides down when an error appears. |
| Particles | `VerifiedBurst` on the action page's status badge | One small green burst right after a consultant accepts the evidence (human verification is the moment worth marking). Never on later visits. |
| Tilt | Project cards on `/projects` | Cards that are whole links lean slightly (3°) toward the pointer. |
| Motion Grid | `ExportButton` busy state | A 3×3 ripple while the export is made. |
| Copy Button | `CopyButton`: inquiry reference, 2FA backup codes | The icon turns into a check after copying. |
| Button | `ui/button.tsx` | Every button springs to 97% on press. |
| Pagination | `ListPager` | The current-page highlight slides to the chosen page. |
| Toast | `ui/toast.tsx` (Base UI) | Every confirmation. |
| Accordion, Alert Dialog, Checkbox, Collapsible, Dialog, Dropdown Menu, Hover Card, Popover, Progress, Radio Group, Select, Sheet, Switch, Tabs, Toggle, Toggle Group, Tooltip | `components/ui/*` on `@animate-ui/react/primitives/radix-ui` | Same API as shadcn; Motion drives their entrances. Keep new shadcn components on these primitives (`npx @animate-ui/cli animate <name>`). |
| Combobox | `components/ui/combobox.tsx` on `@animate-ui/react/primitives/base-ui`; `components/person-picker.tsx` on top | Every pick of one person from a list that can grow (consultants, staff, client people, owners, assignees, attendees): type part of a name or email. In a form dialog use field type `person`. Short fixed lists (roles, yes/no, a handful of choices) stay on Select. Inside a Radix dialog the list portals into the picker's own element so the dialog's focus trap lets it be clicked. |
| Topography | Sign-in, invite, upload link pages | Background of signed-out pages. |
| Lucide icons | `components/animate-ui/icons` | See section 1. |

Not used, on purpose: **Hugeicons** (a second icon family would break the single lucide style), **Scrolling Number** (an odometer strip; Selah has no picker or counter that needs one, Sliding Number covers changing numbers), **Pinned List** (needs a "pin a project" feature that doesn't exist), **Preview Link Card** (Selah links to its own pages, there are no external pages to preview), **Drawer** and **Sheet-style mobile panels** (no phone layouts), **Menubar** and **Navigation Menu** (the sidebar is the navigation; a second menu would crowd the shell), **Slider** (every number in Selah needs an exact value), **Questionnaire** (the inquiry form is already a step-by-step form), **Sidebar** (Selah keeps the shadcn `sidebar-07` shell, which already animates).

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

- **Navigation:** Workspace (Overview and Today side by side in one row, Projects with All / Client / Internal, Clients, Inquiries, Actions, Assessment templates, Assistant) and Organization (Team, plus the Audit log for firm admins). Actions, the review queue and oversight are one entry: three tabs at the top of those pages (`ActionsTabs`), each keeping its own address. Settings sit in the user menu at the foot of the sidebar. The menu must fit a 768 px tall window without scrolling: add a new page as a tab or a sub-item of an existing entry before adding a row.
- **Overview:** four summary cards (In progress, Awaiting review, Blocked, Verified), the overdue alert, then "Needs your decision" as an `ActionsTable`. The footnote that claims are not proof stays.
- **Density:** tables over cards for lists; side panels on detail pages; tabs on the project page.
- **Firm-only content must look firm-only.** Anything a client cannot see (internal projects, private notes and firm notes on actions, firm-only findings and recommendations, scores, firm-only reports and assessments) carries a `Lock` icon or a "Firm only" badge, and internal projects show the muted banner. Scores are firm-only and never appear on client screens.
- **Decisions are explicit:** review actions (accept, request revision, waive) are buttons with a clear outcome, behind a dialog when they need a reason. Nothing changes status silently.
- **People data:** workload is "sorted by name, for allocation, not a rating". Never rank people or colour them by performance.
- **Consultant-managed clients:** screens that record work on the client's behalf say so (the record source is shown).

---

## 11. Client side

Who: client admin, client manager, action owner.

**Purpose of the UI:** know what is asked of you, do it, and prove it. Fewer choices, plainer words.

- **Navigation:** client admins and managers get Overview, Projects, Actions and Team; action owners get Overview, My actions and Projects. No firm tools (inquiries, templates, review queue, assistant) appear. Help (`/help`, F13) is always in the same place for every client role: at the foot of the sidebar above Files, and in the user menu (WCAG 2.2, 3.2.6 consistent help).
- **Overview:** the same summary cards as the firm side, so both sides talk about the same numbers, then "Needs your follow-up".
- **Action page first:** the action page is the client's main screen. The next step sits at the top of the main column, the evidence list below it, the history last; the side panel shows project, recommendation, owner, due date and the evidence the consultant expects.
- **Language:** say what to do next ("Upload the signed charter"), not system states. Avoid firm jargon (triage, conflict check, RLS).
- **Never show:** other clients, firm-only notes, assessment scores, internal projects, consultant workload, or AI features that are not enabled for client roles.
- **Shared items** (reports, files, meeting summaries) show who shared them and when.
- **Claims vs verification:** the client's own update is shown as a claim (`active` or `waiting`) until the firm verifies it; a client never sees green for their own unreviewed work.

---

## 12. Public and sign-in pages

- **Auth pages** (`app/(auth)`): centred `max-w-sm` card (`py-6 shadow-xs`) over the `Topography` background, wordmark above, `text-xl` title. Same tokens and components as the app.
- **Public pages** (`app/(public)`: `/inquiry`, `/privacy`): `max-w-6xl` shell; the inquiry page is a two-column intro and form (`lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`), the privacy page a single `max-w-2xl` text column. These are the only pages with a hero-sized title. An upload link's page (`/upload/<token>`, F14) is one `max-w-xl` card over the `Topography` background: the requested item, the firm's name and the file field, nothing else.
- No client data, staff names or internal wording on public pages.

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

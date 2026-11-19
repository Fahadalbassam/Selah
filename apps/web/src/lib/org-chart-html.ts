// The organisation structure drawn as HTML and CSS: one tree for the screen
// and the PDF (org chart, part 2). Pure: every value is escaped here, nothing
// runs (the PDF service has JavaScript off), and the layout is plain CSS with
// logical properties, so right to left in Arabic and left to right in English
// come from `dir` alone. No canvas, no diagram library, no measuring in the
// browser. On screen the colours are the app's tokens; in the PDF, where no
// token is defined, the same rules fall back to print greys.
import type { VersionStatus } from "./org-chart";
import { escapeHtml, reportFontFaces } from "./report-html";
import { collapsible } from "./org-chart-reading";
import { overview, pageUnits, treeWidth, wraps, type TreePosition, type TreeUnit } from "./org-chart-tree";

export interface TreeLabels {
  /** "Vacant / شاغر": a position nobody holds today. */
  vacant: string;
  /** "Reports to: {title}", for a line the drawing does not show. */
  reportsTo: (title: string) => string;
  /** Deeper levels left out by the depth chosen. */
  moreLevels: string;
  /** On the PDF's overview: the unit has its own page. */
  ownPage: string;
  /** Read out for an advisory unit (drawn with a dotted line). */
  advisory: string;
  /** The drawing's name, for screen readers. */
  label: string;
  /** "See {name}'s work": a person's button on screen, which opens their work card. */
  person: (name: string) => string;
  /** On screen, a unit's fold button: "Collapse {name}" and "Expand {name}". */
  collapse: (name: string) => string;
  expand: (name: string) => string;
  /** On screen, in a collapsed unit's card: what is folded away. */
  folded: string;
}

/** The drawing's words from the messages under "orgChart.tree", in the reader's language. */
export function treeLabels(t: (key: string, values?: Record<string, string>) => string): TreeLabels {
  return {
    vacant: t("tree.vacant"),
    reportsTo: (title) => t("tree.reportsTo", { title }),
    moreLevels: t("tree.moreLevels"),
    ownPage: t("tree.ownPage"),
    advisory: t("tree.advisory"),
    label: t("tree.label"),
    person: (name) => t("tree.person", { name }),
    collapse: (name) => t("tree.collapse", { name }),
    expand: (name) => t("tree.expand", { name }),
    folded: t("tree.folded"),
  };
}

/**
 * The words that say which version is shown, in order: its number (and
 * "current" only for the one in effect today), when it took or takes
 * effect, when it was replaced and by which version (or which version
 * replaces it on a coming day), and whose holders are shown for a replaced
 * one. The same on the screen, in the PDF's heading and in its footer.
 */
export function versionWords(
  v: { number: number | null; effectiveOn: string | null },
  status: VersionStatus,
  asOf: string | null,
  t: (key: string, values?: Record<string, string | number>) => string,
  day: (iso: string) => string,
): string[] {
  const n = v.number ?? 0;
  const from = v.effectiveOn ? t("version.effective", { date: day(v.effectiveOn) }) : null;
  const parts: (string | null)[] =
    status.kind === "draft"
      ? [t("version.unpublished")]
      : status.kind === "upcoming"
        ? [t("version.number", { n }), t("version.upcoming", { date: day(status.on) })]
        : status.kind === "current"
          ? [t("version.current", { n }), from, status.until && status.by ? t("version.replacedSoon", { by: status.by, date: day(status.until) }) : null]
          : [t("version.number", { n }), from, t("version.replaced", { by: status.by, date: day(status.replacedOn) }), asOf ? t("version.asOf", { date: day(asOf) }) : null];
  return parts.filter((p): p is string => p !== null);
}

/** The tree's styles, for the screen (a <style> beside the drawing) and the PDF. */
export const ORG_CHART_CSS = `
.oc{--oc-ink:var(--foreground,#262626);--oc-muted:var(--muted-foreground,#595959);--oc-line:var(--field,#9b9b9b);--oc-border:var(--border,#d2d2d2);--oc-card:var(--card,#fff);--oc-fill:var(--surface,#ececec);--oc-box:12.5rem;--oc-gap:1rem;--oc-drop:1rem;--oc-rail:0.875rem;inline-size:max-content;min-inline-size:100%;color:var(--oc-ink);font-size:0.8125rem;line-height:1.45;}
.oc *,.oc *::before,.oc *::after{box-sizing:border-box;}
.oc :where(ul){list-style:none;margin:0;padding:0;}
.oc :where(p){margin:0;}
.oc-row{position:relative;display:flex;align-items:flex-start;justify-content:center;padding-block-start:var(--oc-drop);}
.oc-row::before{content:"";position:absolute;inset-block-start:0;inset-inline-start:50%;block-size:var(--oc-drop);border-inline-start:1px solid var(--oc-line);}
.oc-row>li{position:relative;display:flex;flex-direction:column;align-items:center;padding:var(--oc-drop) calc(var(--oc-gap) / 2) 0;}
.oc-row>li::before,.oc-row>li::after{content:"";position:absolute;inset-block-start:0;inline-size:50%;block-size:var(--oc-drop);border-block-start:1px solid var(--oc-line);}
.oc-row>li::before{inset-inline-end:50%;}
.oc-row>li::after{inset-inline-start:50%;border-inline-start:1px solid var(--oc-line);}
.oc-row>li:first-child::before{border-block-start:0;}
.oc-row>li:last-child::after{border-block-start:0;}
.oc-row>li.oc-adv::after{border-inline-start:2px dotted var(--oc-line);}
.oc-wrap::after{content:"";position:absolute;inset-block:var(--oc-drop) 0;inset-inline-start:50%;border-inline-start:1px solid var(--oc-line);}
.oc-root{padding-block-start:0;gap:var(--oc-gap);}
.oc-root::before,.oc-root>li::before,.oc-root>li::after{display:none;}
.oc-root>li{padding:0;}
.oc-beside{display:grid;grid-template-columns:1fr 1px 1fr;align-self:stretch;}
.oc-beside::before{content:"";grid-column:2;grid-row:1;background:var(--oc-line);}
.oc-beside-list{grid-column:3;grid-row:1;display:flex;flex-direction:column;gap:0.5rem;padding-block:0.75rem 0.25rem;padding-inline-start:var(--oc-gap);}
.oc-beside-list>li{position:relative;inline-size:var(--oc-box);}
.oc-beside-list>li::before{content:"";position:absolute;inset-block-start:1rem;inset-inline-start:calc(-1 * var(--oc-gap));inline-size:var(--oc-gap);border-block-start:2px dotted var(--oc-line);}
.oc-stack{display:flex;flex-direction:column;gap:0.5rem;padding-block-start:0.5rem;padding-inline-start:var(--oc-rail);}
.oc-row>li>.oc-stack,.oc-beside-list>li>.oc-stack{inline-size:var(--oc-box);align-self:center;}
.oc-stack>li{position:relative;}
.oc-stack>li::before{content:"";position:absolute;inset-inline-start:calc(0.375rem - var(--oc-rail));inset-block-start:-0.5rem;block-size:1.5rem;inline-size:calc(var(--oc-rail) - 0.375rem);border-inline-start:1px solid var(--oc-line);border-block-end:1px solid var(--oc-line);}
.oc-stack>li:not(:last-child)::after{content:"";position:absolute;inset-inline-start:calc(0.375rem - var(--oc-rail));inset-block-start:1rem;inset-block-end:-0.5rem;border-inline-start:1px solid var(--oc-line);}
.oc-stack>li.oc-adv::before{border-block-end:2px dotted var(--oc-line);}
.oc-unit{inline-size:var(--oc-box);overflow:hidden;border:1px solid var(--oc-border);border-radius:0.5rem;background:var(--oc-card);text-align:start;overflow-wrap:anywhere;}
.oc-keep{break-inside:avoid;}
.oc-stack .oc-unit,.oc-beside .oc-unit{inline-size:auto;}
.oc-adv>.oc-unit{border-style:dashed;border-color:var(--oc-line);}
.oc-card{inline-size:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;}
.oc-card thead{display:table-header-group;break-after:avoid;}
.oc-card th{padding:0;font-weight:inherit;text-align:start;}
.oc-card tr{break-inside:avoid;}
.oc-card td{vertical-align:top;}
.oc-head{display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;padding:0.375rem 0.625rem;background:var(--oc-fill);}
.oc-name{font-weight:600;}
.oc-code{flex-shrink:0;font-size:0.75rem;color:var(--oc-muted);font-variant-numeric:tabular-nums;}
.oc-pos{padding:0.375rem 0.625rem;border-block-start:1px solid var(--oc-border);}
.oc-pos+.oc-pos{border-inline-start:1px solid var(--oc-border);}
.oc-lead .oc-title{font-weight:600;}
.oc-who{color:var(--oc-muted);}
.oc-vacant{display:inline-block;margin-block-start:0.125rem;padding:0 0.375rem;border:1px dashed var(--oc-line);border-radius:999px;font-size:0.75rem;color:var(--oc-muted);}
.oc-reports{font-size:0.75rem;color:var(--oc-muted);}
.oc-more{padding:0.375rem 0.625rem;border-block-start:1px dashed var(--oc-border);font-size:0.75rem;color:var(--oc-muted);}
.oc-sr{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.oc-person{margin:0;padding:0;border:0;background:none;font:inherit;color:inherit;text-align:start;cursor:pointer;text-decoration:underline dotted;text-underline-offset:0.2em;border-radius:0.25rem;}
.oc-person:hover{color:var(--oc-ink);}
.oc-person:focus-visible{outline:2px solid var(--ring,#595959);outline-offset:2px;}
`;

/**
 * The screen's reading tools on the drawing (org chart, part 5): a unit's
 * fold button and what folding hides. Screen only: the PDF never has the
 * markup these rules apply to.
 */
export const ORG_CHART_TOOLS_CSS = `
.oc-toggle{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;inline-size:1.25rem;block-size:1.25rem;margin:0;padding:0;border:1px solid var(--oc-border);border-radius:0.25rem;background:var(--oc-card);font:inherit;font-size:0.875rem;line-height:1;color:var(--oc-muted);cursor:pointer;}
.oc-toggle:hover{color:var(--oc-ink);}
.oc-toggle:focus-visible{outline:2px solid var(--ring,#595959);outline-offset:2px;}
.oc-head-start{display:flex;align-items:baseline;gap:0.375rem;min-inline-size:0;}
.oc-folded{display:none;}
li.oc-shut>.oc-row,li.oc-shut>.oc-stack,li.oc-shut>.oc-beside,li.oc-shut>.oc-unit tr.oc-sub,li.oc-shut>.oc-unit tr.oc-more-row{display:none;}
li.oc-shut>.oc-unit tr.oc-folded{display:table-row;}
`;

const e = escapeHtml;

interface Draw {
  labels: TreeLabels;
  sep: string;
  /** On screen: a holder with an account is a button that opens their work card (never in the PDF). */
  people?: boolean;
  /** In print: at most this many units to a row, the rest on further rows. */
  wrap?: number;
  /** On screen: each unit that has something to fold gets a fold button (never in the PDF). */
  tools?: boolean;
}

/** A card holding this many rows or fewer stays whole on one printed page; a longer one runs on, its heading repeated. */
const KEEP_ROWS = 8;

/** A holder's name: plain text, or on screen, for someone with an account, the button to their work card. */
function personHtml(h: { name: string; userId: string | null }, d: Draw): string {
  if (!d.people || !h.userId) return e(h.name);
  return `<button type="button" class="oc-person" data-person="${e(h.userId)}" aria-haspopup="dialog" title="${e(d.labels.person(h.name))}">${e(h.name)}</button>`;
}

function positionHtml(p: TreePosition, d: Draw): string {
  const people = p.people?.length ? p.people : p.names.map((name) => ({ name, userId: null }));
  const who = people.length
    ? `<p class="oc-who">${people.map((h) => personHtml(h, d)).join(d.sep)}</p>`
    : p.vacant === true
      ? `<p class="oc-vacant">${e(d.labels.vacant)}</p>`
      : "";
  const line = p.reportsTo ? `<p class="oc-reports">${e(d.labels.reportsTo(p.reportsTo))}</p>` : "";
  return `<td class="oc-pos${p.head ? " oc-lead" : ""}"><p class="oc-title">${e(p.title)}</p>${who}${line}</td>`;
}

/**
 * A unit's card: a table, so that in print its heading repeats at the top of
 * each page it runs to and a position is never split. Positions one to a row,
 * or side by side in `columns` for a large department alone on its page.
 */
function cardHtml(u: TreeUnit, d: Draw): string {
  const cols = Math.max(1, u.columns ?? 1);
  const fold = !!d.tools && collapsible(u);
  const name = `<p class="oc-name">${e(u.name)}${u.advisory ? `<span class="oc-sr"> (${e(d.labels.advisory)})</span>` : ""}</p>`;
  // The fold button says what pressing it does; the page swaps its words (and its sign) as it folds and unfolds.
  const toggle = fold
    ? `<button type="button" class="oc-toggle" data-toggle="${e(u.id)}" aria-expanded="true" aria-label="${e(d.labels.collapse(u.name))}" title="${e(d.labels.collapse(u.name))}" data-collapse="${e(d.labels.collapse(u.name))}" data-expand="${e(d.labels.expand(u.name))}">−</button>`
    : "";
  const head = `<div class="oc-head">${fold ? `<div class="oc-head-start">${toggle}${name}</div>` : name}<p class="oc-code" dir="ltr">${e(u.code)}</p></div>`;
  const rows: string[] = [];
  for (let i = 0; i < u.positions.length; i += cols) {
    const slice = u.positions.slice(i, i + cols);
    const cells = slice.map((p) => positionHtml(p, d));
    while (cells.length < cols) cells.push(`<td class="oc-pos"></td>`);
    // Folded, a unit keeps its head position in view; every other row folds away.
    const sub = fold && !slice.some((p) => p.head) ? " oc-sub" : "";
    rows.push(`<tr class="oc-row-pos${sub}">${cells.join("")}</tr>`);
  }
  if (u.more) rows.push(`<tr${fold ? ` class="oc-more-row"` : ""}><td class="oc-more" colspan="${cols}">${e(u.more === "page" ? d.labels.ownPage : d.labels.moreLevels)}</td></tr>`);
  if (fold) rows.push(`<tr class="oc-folded"><td class="oc-more" colspan="${cols}">${e(d.labels.folded)}</td></tr>`);
  const keep = rows.length <= KEEP_ROWS ? " oc-keep" : "";
  const width = cols > 1 ? ` style="inline-size:calc(var(--oc-box) * ${cols})"` : "";
  return `<div class="oc-unit${keep}"${width}><table class="oc-card" role="presentation"><thead><tr><th colspan="${cols}">${head}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function unitHtml(u: TreeUnit, d: Draw): string {
  const beside = u.beside.length ? `<div class="oc-beside"><ul class="oc-beside-list">${u.beside.map((b) => nodeHtml(b, d)).join("")}</ul></div>` : "";
  let below = "";
  if (u.children.length && !u.across) below = `<ul class="oc-stack">${u.children.map((c) => nodeHtml(c, d)).join("")}</ul>`;
  else if (u.children.length && wraps(u, d.wrap)) {
    // Rows of at most `wrap` (an even number), the line from above running down between the two middle units.
    const rows: string[] = [];
    for (let i = 0; i < u.children.length; i += d.wrap!) {
      const last = i + d.wrap! >= u.children.length;
      rows.push(`<ul class="oc-row${last ? "" : " oc-wrap"}">${u.children.slice(i, i + d.wrap!).map((c) => nodeHtml(c, d)).join("")}</ul>`);
    }
    below = rows.join("");
  } else if (u.children.length) below = `<ul class="oc-row">${u.children.map((c) => nodeHtml(c, d)).join("")}</ul>`;
  return `${cardHtml(u, d)}${beside}${below}`;
}

function nodeHtml(u: TreeUnit, d: Draw): string {
  return `<li${u.advisory ? ` class="oc-adv"` : ""}${d.tools ? ` data-unit="${e(u.id)}"` : ""}>${unitHtml(u, d)}</li>`;
}

/**
 * The drawing: nested lists of units, positions inside their unit's card,
 * connector lines in CSS. `wrap` (print only) breaks a row of more units
 * than a page holds into several rows. `people` (screen only) makes each
 * holder with an account a button that opens their work card; a typed name
 * stays text, and the PDF never has a button. `tools` (screen only) gives
 * each unit with something to fold a fold button (lib/org-chart-reading.ts).
 */
export function orgTreeHtml(
  roots: readonly TreeUnit[],
  labels: TreeLabels,
  locale: "ar" | "en",
  opts: { wrap?: number; people?: boolean; tools?: boolean } = {},
): string {
  const d: Draw = { labels, sep: locale === "ar" ? "، " : ", ", wrap: opts.wrap, people: opts.people, tools: opts.tools };
  return `<div class="oc" dir="${locale === "ar" ? "rtl" : "ltr"}" lang="${locale}" role="group" aria-label="${e(labels.label)}"><ul class="oc-row oc-root">${roots
    .map((r) => nodeHtml(r, d))
    .join("")}</ul></div>`;
}

export type PaperSize = "a3" | "a4";

/** The PDF's root type size: the drawing's body text is 0.8125 of it. */
export const PDF_ROOT_PT = 11;
/** The smallest the drawing is scaled in print: body text stays at about 8pt (0.8125 × 11pt × 0.9). */
const MIN_ZOOM = 0.9;
/** Printable width of a landscape page, in millimetres (page width less the margins below). */
const PRINT_WIDTH: Record<PaperSize, number> = { a3: 420 - 24, a4: 297 - 24 };
/** One box and the gap beside it (13.5rem), in millimetres. */
const BOX_MM = 13.5 * PDF_ROOT_PT * 0.3528;

/**
 * How many units one printed row holds at the smallest scale: an even number,
 * so the line down to the next row runs between two of them (8 on A3, 4 on A4).
 */
export function wrapAt(size: PaperSize): number {
  const n = Math.floor(PRINT_WIDTH[size] / (BOX_MM * MIN_ZOOM));
  return Math.max(2, n - (n % 2));
}

/**
 * How much a drawing is scaled down to fit the page's width, rows wrapped
 * (never up). With rows wrapped it stays at or above the smallest scale; only
 * a drawing whose upper levels alone are wider than the page goes below it,
 * rather than being cut off.
 */
export function fitZoom(roots: readonly TreeUnit[], size: PaperSize): number {
  return Math.min(1, Math.floor((PRINT_WIDTH[size] / (treeWidth(roots, wrapAt(size)) * BOX_MM)) * 100) / 100);
}

/** Positions per column of a large department alone on its page: up to this many, then another column. */
const ROWS_PER_COLUMN = 8;

/**
 * The PDF's pages: the overview (each top-level department cut to its head
 * position), then one page per top-level department, which spreads its
 * sections across and lays a long list of positions out in columns.
 */
export function pdfPages(roots: readonly TreeUnit[], size: PaperSize): { heading: string | null; roots: TreeUnit[] }[] {
  const departments = pageUnits(roots);
  const across = wrapAt(size);
  return [
    { heading: null, roots: departments.length ? overview(roots, new Set(departments.map((d) => d.id))) : [...roots] },
    ...departments.map((d) => ({
      heading: d.name,
      roots: [
        {
          ...d,
          across: d.children.length > 0,
          columns: d.positions.length > ROWS_PER_COLUMN ? Math.min(across, Math.ceil(d.positions.length / ROWS_PER_COLUMN)) : 1,
        },
      ],
    })),
  ];
}

export interface OrgChartPdfInput {
  locale: "ar" | "en";
  size: PaperSize;
  clientName: string;
  /** "Organisation structure" */
  title: string;
  /** The version and its date, or that this is the firm's draft. */
  meta: string;
  /** A banner on every page of the firm's draft. */
  draftNotice: string | null;
  /** The overview first, then one page per top-level department. */
  pages: { heading: string | null; roots: TreeUnit[] }[];
  labels: TreeLabels;
}

/**
 * The structure as a printable document for the PDF service: A3 or A4
 * landscape, an overview page then one per department. Each page is a table
 * whose heading (the client, the page's heading, the version, and the draft's
 * banner) repeats at the top of every printed page it runs to.
 */
export function renderOrgChartPdfHtml(input: OrgChartPdfInput): string {
  const { locale } = input;
  const page = (p: OrgChartPdfInput["pages"][number]) => `<section class="page">
<table class="frame"><thead><tr><td><header class="top"><div><p class="client">${e(input.clientName)}</p><h1>${e(p.heading ?? input.title)}</h1></div><p class="meta">${e(input.meta)}</p></header>${
    input.draftNotice ? `<p class="draft">${e(input.draftNotice)}</p>` : ""
  }</td></tr></thead>
<tbody><tr><td><div class="fit" style="zoom:${fitZoom(p.roots, input.size)}">${orgTreeHtml(p.roots, input.labels, locale, { wrap: wrapAt(input.size) })}</div></td></tr></tbody></table>
</section>`;
  return `<!doctype html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${e(`${input.title} · ${input.clientName}`)}</title>
<style>${reportFontFaces()}
@page{size:${input.size === "a3" ? "A3" : "A4"} landscape;margin:12mm 12mm 16mm;}
html{font-size:${PDF_ROOT_PT}pt;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;font-family:"Plex",sans-serif;color:#262626;background:#fff;}
p{margin:0;}
.page{break-after:page;}
.page:last-child{break-after:auto;}
.frame{inline-size:100%;border-collapse:collapse;}
.frame thead{display:table-header-group;}
.frame>thead>tr>td,.frame>tbody>tr>td{padding:0;vertical-align:top;}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;border-bottom:1px solid #d2d2d2;padding-bottom:3mm;margin-bottom:6mm;}
.client{font-size:9pt;color:#595959;}
h1{margin:1mm 0 0;font-size:15pt;font-weight:600;line-height:1.3;}
.meta{max-width:60%;font-size:9pt;color:#595959;text-align:end;}
.draft{margin:0 0 5mm;border:1px dashed #9b9b9b;border-radius:2mm;padding:2mm 3mm;font-size:9pt;}
.fit{display:flex;justify-content:center;}
.fit .oc{min-inline-size:0;}
${ORG_CHART_CSS}
</style>
</head>
<body>
${input.pages.map(page).join("\n")}
</body>
</html>`;
}

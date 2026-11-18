// The organisation structure drawn as HTML and CSS: one tree for the screen
// and the PDF (org chart, part 2). Pure: every value is escaped here, nothing
// runs (the PDF service has JavaScript off), and the layout is plain CSS with
// logical properties, so right to left in Arabic and left to right in English
// come from `dir` alone. No canvas, no diagram library, no measuring in the
// browser. On screen the colours are the app's tokens; in the PDF, where no
// token is defined, the same rules fall back to print greys.
import type { VersionStatus } from "./org-chart";
import { escapeHtml, reportFontFaces } from "./report-html";
import { treeWidth, type TreePosition, type TreeUnit } from "./org-chart-tree";

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
.oc-unit{inline-size:var(--oc-box);overflow:hidden;border:1px solid var(--oc-border);border-radius:0.5rem;background:var(--oc-card);text-align:start;overflow-wrap:anywhere;break-inside:avoid;}
.oc-stack .oc-unit,.oc-beside .oc-unit{inline-size:auto;}
.oc-adv>.oc-unit{border-style:dashed;border-color:var(--oc-line);}
.oc-head{display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;padding:0.375rem 0.625rem;background:var(--oc-fill);}
.oc-name{font-weight:600;}
.oc-code{flex-shrink:0;font-size:0.75rem;color:var(--oc-muted);font-variant-numeric:tabular-nums;}
.oc-positions>li{padding:0.375rem 0.625rem;border-block-start:1px solid var(--oc-border);}
.oc-lead .oc-title{font-weight:600;}
.oc-who{color:var(--oc-muted);}
.oc-vacant{display:inline-block;margin-block-start:0.125rem;padding:0 0.375rem;border:1px dashed var(--oc-line);border-radius:999px;font-size:0.75rem;color:var(--oc-muted);}
.oc-reports{font-size:0.75rem;color:var(--oc-muted);}
.oc-more{padding:0.375rem 0.625rem;border-block-start:1px dashed var(--oc-border);font-size:0.75rem;color:var(--oc-muted);}
.oc-sr{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
`;

const e = escapeHtml;

function positionHtml(p: TreePosition, labels: TreeLabels, sep: string): string {
  const who = p.names.length
    ? `<p class="oc-who">${p.names.map(e).join(sep)}</p>`
    : p.vacant === true
      ? `<p class="oc-vacant">${e(labels.vacant)}</p>`
      : "";
  const line = p.reportsTo ? `<p class="oc-reports">${e(labels.reportsTo(p.reportsTo))}</p>` : "";
  return `<li class="oc-pos${p.head ? " oc-lead" : ""}"><p class="oc-title">${e(p.title)}</p>${who}${line}</li>`;
}

function unitHtml(u: TreeUnit, labels: TreeLabels, sep: string): string {
  const head = `<div class="oc-head"><p class="oc-name">${e(u.name)}${u.advisory ? `<span class="oc-sr"> (${e(labels.advisory)})</span>` : ""}</p><p class="oc-code" dir="ltr">${e(u.code)}</p></div>`;
  const list = u.positions.length ? `<ul class="oc-positions">${u.positions.map((p) => positionHtml(p, labels, sep)).join("")}</ul>` : "";
  const more = u.more ? `<p class="oc-more">${e(u.more === "page" ? labels.ownPage : labels.moreLevels)}</p>` : "";
  const beside = u.beside.length
    ? `<div class="oc-beside"><ul class="oc-beside-list">${u.beside.map((b) => nodeHtml(b, labels, sep)).join("")}</ul></div>`
    : "";
  const below = u.children.length
    ? `<ul class="${u.across ? "oc-row" : "oc-stack"}">${u.children.map((c) => nodeHtml(c, labels, sep)).join("")}</ul>`
    : "";
  return `<div class="oc-unit">${head}${list}${more}</div>${beside}${below}`;
}

function nodeHtml(u: TreeUnit, labels: TreeLabels, sep: string): string {
  return `<li${u.advisory ? ` class="oc-adv"` : ""}>${unitHtml(u, labels, sep)}</li>`;
}

/** The drawing: nested lists of units, positions inside them, connector lines in CSS. */
export function orgTreeHtml(roots: readonly TreeUnit[], labels: TreeLabels, locale: "ar" | "en"): string {
  const sep = locale === "ar" ? "، " : ", ";
  return `<div class="oc" dir="${locale === "ar" ? "rtl" : "ltr"}" lang="${locale}" role="group" aria-label="${e(labels.label)}"><ul class="oc-row oc-root">${roots
    .map((r) => nodeHtml(r, labels, sep))
    .join("")}</ul></div>`;
}

export type PaperSize = "a3" | "a4";

/** Printable width of a landscape page, in millimetres (page width less the margins below). */
const PRINT_WIDTH: Record<PaperSize, number> = { a3: 420 - 24, a4: 297 - 24 };
/** One box and the gap beside it, in millimetres, at the PDF's 10pt root size (13.5rem). */
const BOX_MM = 13.5 * 10 * 0.3528;

/** How much a drawing is scaled down to fit the page's width (never up). */
export function fitZoom(roots: readonly TreeUnit[], size: PaperSize): number {
  return Math.min(1, Math.floor((PRINT_WIDTH[size] / (treeWidth(roots) * BOX_MM)) * 100) / 100);
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

/** The structure as a printable document for the PDF service: A3 or A4 landscape, an overview page then one per department. */
export function renderOrgChartPdfHtml(input: OrgChartPdfInput): string {
  const { locale } = input;
  const page = (p: OrgChartPdfInput["pages"][number]) => `<section class="page">
  <header class="top"><div><p class="client">${e(input.clientName)}</p><h1>${e(p.heading ?? input.title)}</h1></div><p class="meta">${e(input.meta)}</p></header>
  ${input.draftNotice ? `<p class="draft">${e(input.draftNotice)}</p>` : ""}
  <div class="fit" style="zoom:${fitZoom(p.roots, input.size)}">${orgTreeHtml(p.roots, input.labels, locale)}</div>
</section>`;
  return `<!doctype html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${e(`${input.title} · ${input.clientName}`)}</title>
<style>${reportFontFaces()}
@page{size:${input.size === "a3" ? "A3" : "A4"} landscape;margin:12mm 12mm 16mm;}
html{font-size:10pt;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;font-family:"Plex",sans-serif;color:#262626;background:#fff;}
p{margin:0;}
.page{break-after:page;}
.page:last-child{break-after:auto;}
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

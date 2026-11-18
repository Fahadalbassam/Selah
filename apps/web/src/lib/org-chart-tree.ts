// The client's organisation structure as a tree to draw (org chart, part 2).
// Pure: it arranges what the services return (getPublishedChart, getDraft,
// getVersion) and never decides whose names a reader sees. A holder arrives
// with a name only where the database allowed it; this keeps that name or,
// when the reader asked for a copy without names, drops it. One arrangement
// feeds both the screen and the PDF (lib/org-chart-html.ts).
//
// The layout follows the firm's own slides: the governing and executive
// levels (board, committee, executive, sector) spread their units across the
// page, down to the departments; inside a department its sections and
// positions stack downward. Advisory units (internal audit beside the chief
// executive) sit beside their parent on a dotted line. Selah draws what the
// firm decided: nothing here counts, scores or judges a structure.
import type { OrgUnitKind } from "./org-chart";

export interface ChartUnitIn {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  code: string;
  nameAr: string | null;
  nameEn: string | null;
  level: number;
  sortOrder: number;
  advisory: boolean;
}

export interface ChartPositionIn {
  id: string;
  unitId: string;
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  reportsToId: string | null;
  isHead: boolean;
  sortOrder: number;
  /** As the service returns them: a name (and the person, for someone with an account) only where the reader may see it. */
  holders: { name: string | null; named: boolean; userId?: string | null }[];
  /** Nobody holds it on the day read; null where the reader gets titles only. */
  vacant: boolean | null;
}

export interface TreePosition {
  id: string;
  code: string;
  title: string;
  head: boolean;
  /** The holders' names the reader may see, and asked for. */
  names: string[];
  /** The same holders with their account, if any: on screen, a person with an account has a work card (part 3). */
  people: { name: string; userId: string | null }[];
  /** True: nobody holds it ("Vacant"). Null: titles only, nothing said about who holds it. */
  vacant: boolean | null;
  /** The title of the position it reports to, when the drawing does not already show that line. */
  reportsTo: string | null;
}

export interface TreeUnit {
  id: string;
  code: string;
  name: string;
  kind: OrgUnitKind;
  level: number;
  advisory: boolean;
  /** Its units run across the page (governing and executive levels) or stack downward (inside a department). */
  across: boolean;
  /** Head position first, then the firm's order. */
  positions: TreePosition[];
  /** Advisory units drawn beside it on a dotted line (only when other units hang below it). */
  beside: TreeUnit[];
  children: TreeUnit[];
  /** Why part of it is not drawn here: deeper levels left out, or its own page in the PDF. */
  more: "levels" | "page" | null;
  /** Positions side by side, in this many columns (a large department alone on its PDF page); one when left out. */
  columns?: number;
}

/** Kinds whose units spread across the page; every other kind stacks its units downward. */
export const ACROSS_KINDS: ReadonlySet<OrgUnitKind> = new Set(["board", "committee", "executive", "sector"]);
/** The governing and executive levels above the departments (the PDF's overview page). */
export const TOP_KINDS: ReadonlySet<OrgUnitKind> = new Set(["board", "committee", "executive"]);

/** Codes in reading order: "2.9" before "2.10", digits by value, letters as written. */
export function compareCodes(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** A unit's name or a position's title in the reader's language, the other language when it has none. */
export function localText(ar: string | null, en: string | null, locale: "ar" | "en"): string {
  return (locale === "ar" ? (ar ?? en) : (en ?? ar)) ?? "";
}

const byOrder = <T extends { sortOrder: number; code: string }>(a: T, b: T) => a.sortOrder - b.sortOrder || compareCodes(a.code, b.code);

/** The levels the depth control offers: each level the structure has, lowest first. */
export function chartLevels(units: readonly Pick<ChartUnitIn, "level">[]): number[] {
  return [...new Set(units.map((u) => u.level))].sort((a, b) => a - b);
}

/** The depth asked in the address: a level the structure has, or null for every level. */
export function parseDepth(raw: string | null | undefined, levels: readonly number[]): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return levels.includes(n) && n < (levels.at(-1) ?? 0) ? n : null;
}

export interface TreeOptions {
  locale: "ar" | "en";
  /** Draw units down to this level (the top ones always); null for every level. */
  depth: number | null;
  /** False: no holder's name at all (a copy without names). True: the names the service sent. */
  names: boolean;
}

/**
 * Arrange a version's units and positions into the tree to draw. Units nest
 * by parent, in the firm's order; positions sit in their unit, the head
 * first. A position's "reports to" is written in its box only when the
 * drawing does not already show it: the head of a unit is expected to report
 * to the head of the unit above, anyone else to the head of their own unit.
 */
export function buildTree(units: readonly ChartUnitIn[], positions: readonly ChartPositionIn[], opts: TreeOptions): TreeUnit[] {
  const ids = new Set(units.map((u) => u.id));
  const kids = new Map<string | null, ChartUnitIn[]>();
  for (const u of units) {
    const parent = u.parentId && ids.has(u.parentId) && u.parentId !== u.id ? u.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), u]);
  }
  for (const list of kids.values()) list.sort(byOrder);
  const parentOf = new Map(units.map((u) => [u.id, u.parentId && ids.has(u.parentId) ? u.parentId : null]));

  const inUnit = new Map<string, ChartPositionIn[]>();
  for (const p of positions) inUnit.set(p.unitId, [...(inUnit.get(p.unitId) ?? []), p]);
  for (const list of inUnit.values()) list.sort((a, b) => Number(b.isHead) - Number(a.isHead) || byOrder(a, b));
  const headOf = (unitId: string | null) => (unitId ? (inUnit.get(unitId)?.find((p) => p.isHead) ?? null) : null);
  const byId = new Map(positions.map((p) => [p.id, p]));

  /** Whom the drawing already shows this position reporting to. */
  const shownManager = (p: ChartPositionIn): string | null => {
    const parentHead = headOf(parentOf.get(p.unitId) ?? null);
    if (p.isHead) return parentHead?.id ?? null;
    const own = headOf(p.unitId);
    return own && own.id !== p.id ? own.id : (parentHead?.id ?? null);
  };

  const position = (p: ChartPositionIn): TreePosition => {
    const boss = p.reportsToId ? byId.get(p.reportsToId) : undefined;
    return {
      id: p.id,
      code: p.code,
      title: localText(p.titleAr, p.titleEn, opts.locale),
      head: p.isHead,
      names: opts.names ? p.holders.flatMap((h) => (h.named && h.name ? [h.name] : [])) : [],
      people: opts.names ? p.holders.flatMap((h) => (h.named && h.name ? [{ name: h.name, userId: h.userId ?? null }] : [])) : [],
      vacant: p.vacant,
      reportsTo: boss && boss.id !== shownManager(p) ? localText(boss.titleAr, boss.titleEn, opts.locale) : null,
    };
  };

  const drawn = (u: ChartUnitIn) => opts.depth === null || u.level <= opts.depth;
  const seen = new Set<string>();

  const unit = (u: ChartUnitIn, parentAcross: boolean): TreeUnit => {
    seen.add(u.id);
    const across = parentAcross && ACROSS_KINDS.has(u.kind);
    const under = (kids.get(u.id) ?? []).filter((c) => !seen.has(c.id));
    const shown = under.filter(drawn);
    const regular = shown.filter((c) => !c.advisory);
    // Beside the unit when units hang below it; otherwise in line with the others, still on a dotted line.
    const besideIt = across && regular.length > 0;
    const beside = besideIt ? shown.filter((c) => c.advisory).map((c) => unit(c, false)) : [];
    const children = (besideIt ? regular : shown).map((c) => unit(c, across));
    return {
      id: u.id,
      code: u.code,
      name: localText(u.nameAr, u.nameEn, opts.locale),
      kind: u.kind,
      level: u.level,
      advisory: u.advisory,
      across,
      positions: (inUnit.get(u.id) ?? []).map(position),
      beside,
      children,
      more: shown.length < under.length ? "levels" : null,
    };
  };

  return (kids.get(null) ?? []).map((r) => unit(r, true));
}

/**
 * The PDF's department pages: the first units below the governing and
 * executive levels (departments, or sectors where the client has them), in
 * the order drawn. Advisory units stay on the overview.
 */
export function pageUnits(roots: readonly TreeUnit[]): TreeUnit[] {
  const out: TreeUnit[] = [];
  const walk = (u: TreeUnit) => {
    if (u.advisory) return;
    if (TOP_KINDS.has(u.kind)) u.children.forEach(walk);
    else out.push(u);
  };
  roots.forEach(walk);
  return out;
}

/** The overview: the units that get a page of their own show their head position only, and say the rest is on their page. */
export function overview(roots: readonly TreeUnit[], own: ReadonlySet<string>): TreeUnit[] {
  const cut = (u: TreeUnit): TreeUnit => {
    if (!own.has(u.id)) return { ...u, beside: u.beside.map(cut), children: u.children.map(cut) };
    const head = u.positions.filter((p) => p.head);
    const left = u.children.length + u.beside.length > 0 || u.positions.length > head.length || u.more !== null;
    return { ...u, positions: head, beside: [], children: [], more: left ? "page" : null };
  };
  return roots.map(cut);
}

/** Whether a unit's row of units can wrap onto more rows: more of them than fit, each one box wide. */
export function wraps(u: TreeUnit, wrap: number | undefined): boolean {
  return !!wrap && u.across && u.children.length > wrap && u.children.every((c) => treeWidth([c]) === 1);
}

/**
 * How many boxes wide a drawing is, for fitting it on a printed page: units
 * across the page add up (or, wrapped, as many as one row holds); a unit with
 * advisory units beside it is at least two boxes and a little wider; a
 * stacked department is one box, or its columns of positions.
 */
export function treeWidth(roots: readonly TreeUnit[], wrap?: number): number {
  const width = (u: TreeUnit): number => {
    const below = !(u.across && u.children.length) ? 1 : wraps(u, wrap) ? wrap! : u.children.reduce((n, c) => n + width(c), 0);
    return Math.max(below, u.beside.length ? 2.3 : 1, u.columns ?? 1);
  };
  return Math.max(1, roots.reduce((n, r) => n + width(r), 0));
}

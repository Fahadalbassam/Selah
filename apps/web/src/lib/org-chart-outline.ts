// The outline editor's arithmetic (org chart, part 3): the draft as an
// indented list, and what each row's "move up", "move down", "indent" and
// "outdent" asks the server for. Pure, so it is tested without a browser.
// The server (services/org-chart.ts: moveUnit, movePosition) still checks
// every move; nothing here decides what is allowed.
import { compareCodes } from "./org-chart-tree";

export interface OutlineUnitIn {
  id: string;
  parentId: string | null;
  code: string;
  sortOrder: number;
}

export interface OutlinePositionIn {
  id: string;
  unitId: string;
  code: string;
  sortOrder: number;
  reportsToId: string | null;
}

export interface OutlineNode<U, P> {
  unit: U;
  /** Its place among its siblings, from 0, and how many siblings there are. */
  index: number;
  siblings: number;
  /** The sibling just above it (where "indent" puts it), and the unit it sits under. */
  previousId: string | null;
  parentId: string | null;
  /** Its parent's place among the parent's siblings (where "outdent" puts it: just after its parent). */
  parentIndex: number | null;
  /** The parent's parent ("outdent" puts it there). */
  grandparentId: string | null;
  depth: number;
  positions: P[];
  children: OutlineNode<U, P>[];
}

const byOrder = <T extends { sortOrder: number; code: string }>(a: T, b: T) => a.sortOrder - b.sortOrder || compareCodes(a.code, b.code);

/**
 * The draft as a tree, in the firm's order: units under their parent, the
 * positions of each unit in their own order (the head is not moved first
 * here, unlike the drawing, so "move up" and "move down" mean what they say).
 */
export function outlineTree<U extends OutlineUnitIn, P extends OutlinePositionIn>(units: readonly U[], positions: readonly P[]): OutlineNode<U, P>[] {
  const ids = new Set(units.map((u) => u.id));
  const kids = new Map<string | null, U[]>();
  for (const u of units) {
    const parent = u.parentId && ids.has(u.parentId) && u.parentId !== u.id ? u.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), u]);
  }
  for (const list of kids.values()) list.sort(byOrder);
  const inUnit = new Map<string, P[]>();
  for (const p of positions) inUnit.set(p.unitId, [...(inUnit.get(p.unitId) ?? []), p]);
  for (const list of inUnit.values()) list.sort(byOrder);
  const seen = new Set<string>();
  const build = (parent: OutlineNode<U, P> | null, list: U[], depth: number): OutlineNode<U, P>[] =>
    list
      .filter((u) => !seen.has(u.id))
      .map((u, index, all) => {
        seen.add(u.id);
        const node: OutlineNode<U, P> = {
          unit: u,
          index,
          siblings: all.length,
          previousId: index > 0 ? all[index - 1]!.id : null,
          parentId: parent?.unit.id ?? null,
          parentIndex: parent?.index ?? null,
          grandparentId: parent?.parentId ?? null,
          depth,
          positions: inUnit.get(u.id) ?? [],
          children: [],
        };
        node.children = build(node, kids.get(u.id) ?? [], depth + 1);
        return node;
      });
  return build(null, kids.get(null) ?? [], 0);
}

export type UnitMove = "up" | "down" | "indent" | "outdent";

/** What a unit's move asks the server (POST /api/org-chart/units/:id/move), or null when the move goes nowhere. */
export function unitMove(node: Pick<OutlineNode<unknown, unknown>, "index" | "siblings" | "previousId" | "parentId" | "parentIndex" | "grandparentId">, move: UnitMove) {
  switch (move) {
    case "up":
      return node.index > 0 ? { parentId: node.parentId, index: node.index - 1 } : null;
    case "down":
      return node.index < node.siblings - 1 ? { parentId: node.parentId, index: node.index + 1 } : null;
    case "indent":
      // Under the unit just above it, as its last unit.
      return node.previousId ? { parentId: node.previousId } : null;
    case "outdent":
      // Out of its parent, just after it.
      return node.parentId ? { parentId: node.grandparentId, index: (node.parentIndex ?? 0) + 1 } : null;
  }
}

/** What a position's move up or down asks the server (POST /api/org-chart/positions/:id/move), or null. */
export function positionMove(list: readonly { id: string; unitId: string }[], id: string, move: "up" | "down") {
  const index = list.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const to = move === "up" ? index - 1 : index + 1;
  return to < 0 || to >= list.length ? null : { unitId: list[index]!.unitId, index: to };
}

/** A unit and every unit under it: where it may not be moved. */
export function unitAndBelow(units: readonly Pick<OutlineUnitIn, "id" | "parentId">[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * The positions a position may report to: any other position of the draft
 * except those that already report to it, even through others (that would
 * make a loop; the server and the database refuse it too).
 */
export function reportsToChoices<P extends Pick<OutlinePositionIn, "id" | "reportsToId">>(positions: readonly P[], id: string | null): P[] {
  if (!id) return [...positions];
  const managerOf = new Map(positions.map((p) => [p.id, p.reportsToId]));
  const reachesMe = (start: string) => {
    for (let at: string | null | undefined = start, n = 0; at && n <= positions.length; at = managerOf.get(at), n++) if (at === id) return true;
    return false;
  };
  return positions.filter((p) => p.id !== id && !reachesMe(p.id));
}

/** Specialties typed one per line (or split by ";", "؛" or ","), as the services keep them. */
export function parseSpecialties(text: string): string[] {
  const out: string[] = [];
  for (const s of text.split(/[\n;؛,،]/)) {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The keyboard move for Alt with an arrow on a row: up and down move it;
 * the side arrows indent (towards the reading direction's end) and outdent.
 * In Arabic the end is the left.
 */
export function arrowMove(key: string, rtl: boolean): UnitMove | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return rtl ? "indent" : "outdent";
  if (key === "ArrowRight") return rtl ? "outdent" : "indent";
  return null;
}

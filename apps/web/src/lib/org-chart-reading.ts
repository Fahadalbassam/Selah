// The reading tools of the drawn structure on screen (org chart, part 5):
// collapse and expand per unit, zoom and pan, and focus on one department.
// Pure: the rules the Structure tab's drawing follows, kept apart from the
// browser so they can be tested. The PDF has none of this (it is laid out on
// the server with JavaScript off and always prints the whole structure, or
// the depth chosen).
import { pageUnits, type TreeUnit } from "./org-chart-tree";

/** The zoom levels the − and + buttons step through; 1 is the drawing's own size. */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const ZOOM_DEFAULT = 1;

/** The nearest step to a zoom, so a value from anywhere lands on the scale. */
function nearest(z: number): number {
  return ZOOM_STEPS.reduce((best, s) => (Math.abs(s - z) < Math.abs(best - z) ? s : best), ZOOM_STEPS[0]);
}

/** One step larger, and no larger than the last. */
export function zoomIn(z: number): number {
  const i = ZOOM_STEPS.indexOf(nearest(z) as (typeof ZOOM_STEPS)[number]);
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, i + 1)]!;
}

/** One step smaller, and no smaller than the first. */
export function zoomOut(z: number): number {
  const i = ZOOM_STEPS.indexOf(nearest(z) as (typeof ZOOM_STEPS)[number]);
  return ZOOM_STEPS[Math.max(0, i - 1)]!;
}

/** The zoom as the reader sees it: a whole percentage. */
export const zoomPercent = (z: number) => Math.round(z * 100);

/**
 * Whether a unit can be collapsed: something is drawn under or beside it, or
 * it has positions besides its head. Collapsed, it keeps its card and its
 * head position; the rest folds away until it is expanded again.
 */
export function collapsible(u: TreeUnit): boolean {
  return u.children.length > 0 || u.beside.length > 0 || u.positions.some((p) => !p.head);
}

/** Every unit of the drawing that can be collapsed, in reading order (for "collapse all"). */
export function collapsibleIds(roots: readonly TreeUnit[]): string[] {
  const out: string[] = [];
  const walk = (u: TreeUnit) => {
    if (collapsible(u)) out.push(u.id);
    u.beside.forEach(walk);
    u.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** The units collapsed after one is pressed: in if it was out, out if it was in. */
export function toggled(collapsed: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The units the reader can focus on: the departments (or the sectors, where
 * the client has them) below the governing and executive levels, the same
 * units the PDF gives a page each.
 */
export function focusChoices(roots: readonly TreeUnit[]): { id: string; code: string; name: string }[] {
  return pageUnits(roots).map((u) => ({ id: u.id, code: u.code, name: u.name }));
}

/**
 * The drawing focused on one unit: that unit alone, its sections spread
 * across as on its PDF page. Null when the unit is not one of the choices
 * (a unit of another version, a level not drawn): the page then shows the
 * whole structure.
 */
export function focusTree(roots: readonly TreeUnit[], unitId: string | null | undefined): TreeUnit[] | null {
  if (!unitId) return null;
  const u = pageUnits(roots).find((x) => x.id === unitId);
  return u ? [{ ...u, across: u.children.length > 0 }] : null;
}

/** How far one press of an arrow key pans the drawing, in pixels. */
export const PAN_STEP = 80;

/**
 * Which way an arrow key pans the drawing: the key's own direction on the
 * screen, in Arabic as in English (scrolling is physical, so the drawing
 * moves the way the arrow points whatever the reading direction). Null for
 * any other key.
 */
export function panBy(key: string, step = PAN_STEP): { left: number; top: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { left: -step, top: 0 };
    case "ArrowRight":
      return { left: step, top: 0 };
    case "ArrowUp":
      return { left: 0, top: -step };
    case "ArrowDown":
      return { left: 0, top: step };
    default:
      return null;
  }
}

/** What a key does on the focused drawing: zoom in or out, back to its own size, or pan. */
export function toolKey(key: string): "in" | "out" | "reset" | "pan" | null {
  if (key === "+" || key === "=") return "in";
  if (key === "-" || key === "_") return "out";
  if (key === "0") return "reset";
  return panBy(key) ? "pan" : null;
}

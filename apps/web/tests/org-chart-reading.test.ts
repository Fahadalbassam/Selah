// Org chart, part 5: the reading tools of the drawing on screen (collapse
// and expand per unit, zoom and pan, focus on one department), what the
// publishing screen lists as changed, and "your manager" in the person's
// menu. The PDF keeps none of the screen's tools.
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { yourManagers } from "@/lib/org-chart";
import { structureChanges, type ChangePosition, type ChangeUnit } from "@/lib/org-chart-changes";
import { ORG_CHART_CSS, orgTreeHtml, pdfPages, renderOrgChartPdfHtml, treeLabels } from "@/lib/org-chart-html";
import { collapsible, collapsibleIds, focusChoices, focusTree, panBy, toggled, toolKey, ZOOM_DEFAULT, ZOOM_STEPS, zoomIn, zoomOut, zoomPercent } from "@/lib/org-chart-reading";
import { buildTree, type ChartPositionIn, type ChartUnitIn } from "@/lib/org-chart-tree";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const unit = (id: string, parentId: string | null, kind: ChartUnitIn["kind"], level: number, extra: Partial<ChartUnitIn> = {}): ChartUnitIn => ({
  id,
  parentId,
  kind,
  code: id,
  nameAr: `وحدة ${id}`,
  nameEn: `Unit ${id}`,
  level,
  sortOrder: 0,
  advisory: false,
  ...extra,
});
const pos = (id: string, unitId: string, extra: Partial<ChartPositionIn> = {}): ChartPositionIn => ({
  id,
  unitId,
  code: id,
  titleAr: `منصب ${id}`,
  titleEn: `Position ${id}`,
  reportsToId: null,
  isHead: false,
  sortOrder: 0,
  holders: [],
  vacant: true,
  ...extra,
});

// The board, the chief executive with internal audit beside him, two departments (one with a section), and a lone office.
const UNITS = [
  unit("1", null, "board", 1),
  unit("2", "1", "executive", 2),
  unit("2.9", "2", "unit", 3, { advisory: true }),
  unit("2.1", "2", "department", 3),
  unit("2.1.1", "2.1", "section", 4),
  unit("2.2", "2", "department", 3),
];
const POSITIONS = [
  pos("p1", "1", { isHead: true }),
  pos("p2", "2", { isHead: true }),
  pos("p21", "2.1", { isHead: true }),
  pos("p21b", "2.1"),
  pos("p211", "2.1.1", { isHead: true }),
  pos("p22", "2.2", { isHead: true }),
];
const tree = (depth: number | null = null, locale: "ar" | "en" = "en") => buildTree(UNITS, POSITIONS, { locale, depth, names: true });
const labels = (messages: typeof en | typeof ar, locale: "ar" | "en") => {
  const t = createTranslator({ locale, messages, namespace: "orgChart" });
  return treeLabels((k, v) => t(k as "title", v as never));
};

describe("collapse and expand per unit", () => {
  it("folds a unit with something under or beside it, or positions besides its head; never one with nothing to fold", () => {
    const roots = tree();
    const find = (code: string) => {
      const walk = (u: (typeof roots)[number]): (typeof roots)[number] | undefined =>
        u.code === code ? u : [...u.beside, ...u.children].map(walk).find(Boolean);
      return roots.map(walk).find(Boolean)!;
    };
    expect(collapsible(find("1"))).toBe(true);
    expect(collapsible(find("2"))).toBe(true); // units below, audit beside
    expect(collapsible(find("2.1"))).toBe(true); // a section and a second position
    expect(collapsible(find("2.2"))).toBe(false); // its head only
    expect(collapsible(find("2.1.1"))).toBe(false);
    expect(collapsibleIds(roots)).toEqual(["1", "2", "2.1"]);
  });

  it("toggles one unit at a time, without changing the set it was given", () => {
    const none = new Set<string>();
    const one = toggled(none, "2.1");
    expect([...one]).toEqual(["2.1"]);
    expect(none.size).toBe(0);
    expect([...toggled(one, "2")].sort()).toEqual(["2", "2.1"]);
    expect([...toggled(one, "2.1")]).toEqual([]);
  });

  it("marks the screen's drawing for folding: a fold button on each unit that folds, its words in both languages, the head row kept", () => {
    for (const [messages, locale] of [
      [ar, "ar"],
      [en, "en"],
    ] as const) {
      const html = orgTreeHtml(tree(null, locale), labels(messages, locale), locale, { tools: true });
      expect(html.match(/data-toggle="/g)).toHaveLength(3);
      expect(html).toContain('data-unit="2.1.1"');
      expect(html).toContain('aria-expanded="true"');
      const collapse = locale === "ar" ? "طيّ ما تحت «وحدة 2.1»" : "Collapse what is under Unit 2.1";
      expect(html).toContain(`aria-label="${collapse}"`);
      // The second position of 2.1 folds away; its head stays.
      expect(html).toMatch(/<tr class="oc-row-pos oc-sub"><td class="oc-pos"><p class="oc-title">Position p21b|<tr class="oc-row-pos oc-sub"><td class="oc-pos"><p class="oc-title">منصب p21b/);
      expect(html).toContain('class="oc-folded"');
    }
  });

  it("leaves the PDF as it was: no fold button, no unit marks, no screen-only rules, nothing that runs", () => {
    const html = renderOrgChartPdfHtml({
      locale: "ar",
      size: "a3",
      clientName: "شركة سهم",
      title: "الهيكل التنظيمي",
      meta: "الإصدار 2",
      draftNotice: null,
      pages: pdfPages(tree(), "a3"),
      labels: labels(ar, "ar"),
    });
    expect(html).not.toMatch(/data-toggle|data-unit|oc-toggle|oc-shut|oc-folded|<script/);
    expect(ORG_CHART_CSS).not.toMatch(/oc-toggle|oc-shut/);
    // Without the option, the screen's drawing is the PDF's drawing.
    expect(orgTreeHtml(tree(), labels(en, "en"), "en")).not.toMatch(/data-toggle|data-unit/);
  });
});

describe("focus on one department", () => {
  it("offers the departments the PDF gives a page each, and draws one alone with its sections across", () => {
    const roots = tree();
    expect(focusChoices(roots).map((c) => c.code)).toEqual(["2.1", "2.2"]);
    const one = focusTree(roots, "2.1")!;
    expect(one).toHaveLength(1);
    expect(one[0]!.code).toBe("2.1");
    expect(one[0]!.across).toBe(true);
    expect(one[0]!.children.map((c) => c.code)).toEqual(["2.1.1"]);
    // Anything else draws the whole structure: nothing, the board, an advisory unit, an unknown id.
    for (const id of [null, undefined, "", "1", "2.9", "nope"]) expect(focusTree(roots, id)).toBeNull();
  });

  it("follows the depth drawn: a department below it is not offered", () => {
    expect(focusChoices(tree(2)).map((c) => c.code)).toEqual([]);
  });
});

describe("zoom and pan", () => {
  it("steps through the scale and stops at both ends", () => {
    expect(ZOOM_DEFAULT).toBe(1);
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomOut(1)).toBe(0.9);
    expect(zoomOut(ZOOM_STEPS[0])).toBe(ZOOM_STEPS[0]);
    expect(zoomIn(ZOOM_STEPS[ZOOM_STEPS.length - 1]!)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    // A value off the scale lands on its nearest step first.
    expect(zoomIn(0.98)).toBe(1.1);
    expect(zoomPercent(0.67)).toBe(67);
  });

  it("pans the way the arrow points, the same in Arabic and in English (scrolling is physical)", () => {
    expect(panBy("ArrowLeft")).toEqual({ left: -80, top: 0 });
    expect(panBy("ArrowRight")).toEqual({ left: 80, top: 0 });
    expect(panBy("ArrowUp", 10)).toEqual({ left: 0, top: -10 });
    expect(panBy("ArrowDown", 10)).toEqual({ left: 0, top: 10 });
    expect(panBy("Enter")).toBeNull();
  });

  it("reads + and − to zoom, 0 to go back, the arrows to pan, and nothing else", () => {
    expect(["+", "=", "-", "_", "0", "ArrowLeft", "a", " ", "Tab"].map(toolKey)).toEqual(["in", "in", "out", "out", "reset", "pan", null, null, null]);
  });

  it("has every word of the tools in both languages", () => {
    const keys = Object.keys(en.orgChart.reading).sort();
    expect(Object.keys(ar.orgChart.reading).sort()).toEqual(keys);
    for (const k of ["collapse", "expand", "folded"] as const) {
      expect(ar.orgChart.tree[k]).toBeTruthy();
      expect(en.orgChart.tree[k]).toBeTruthy();
    }
  });
});

describe("what publishing changes", () => {
  const u = (id: string, parentId: string | null, code: string, name = code): ChangeUnit => ({ id, parentId, code, nameAr: null, nameEn: name });
  const p = (id: string, lineageId: string, unitId: string, code: string, title = code): ChangePosition => ({ id, lineageId, unitId, code, titleAr: null, titleEn: title });
  const before = {
    units: [u("a", null, "1"), u("b", "a", "2"), u("c", "a", "3", "Old name")],
    positions: [p("pa", "L1", "a", "1.1"), p("pb", "L2", "b", "2.1"), p("pc", "L3", "c", "3.1", "Clerk")],
  };

  it("finds units by the draft's copy first, then by code; positions by lineage", () => {
    const after = {
      // The draft's copies: x of a, y of b (now under c... moved), z of c renamed; w new; nothing of nothing removed.
      units: [u("x", null, "1"), u("z", "x", "3", "New name"), u("y", "z", "2"), u("w", "x", "4")],
      positions: [p("qa", "L1", "x", "1.1"), p("qb", "L2", "w", "2.1"), p("qn", "Lnew", "w", "4.1", "Treasurer")],
    };
    const copy: Record<string, string> = { x: "a", y: "b", z: "c" };
    const c = structureChanges(before, after, (id) => copy[id] ?? null);
    expect(c.units.added.map((x) => x.code)).toEqual(["4"]);
    expect(c.units.moved.map((m) => [m.unit.code, m.from?.code, m.to?.code])).toEqual([["2", "1", "3"]]);
    expect(c.units.renamed.map((m) => [m.before.nameEn, m.unit.nameEn])).toEqual([["Old name", "New name"]]);
    expect(c.units.removed).toEqual([]);
    expect(c.positions.added.map((x) => x.code)).toEqual(["4.1"]);
    expect(c.positions.moved.map((m) => [m.position.code, m.from?.code, m.to?.code])).toEqual([["2.1", "2", "4"]]);
    expect(c.positions.removed.map((x) => x.code)).toEqual(["3.1"]);
    expect(c.none).toBe(false);
  });

  it("matches by code when the draft was rebuilt (an import that replaced it), and says when nothing changes", () => {
    const rebuilt = { units: before.units.map((x) => ({ ...x, id: `n${x.id}`, parentId: x.parentId ? `n${x.parentId}` : null })), positions: before.positions.map((x) => ({ ...x, id: `n${x.id}`, unitId: `n${x.unitId}` })) };
    expect(structureChanges(before, rebuilt).none).toBe(true);
  });

  it("lists everything as added for a first version", () => {
    const c = structureChanges({ units: [], positions: [] }, before);
    expect(c.units.added).toHaveLength(3);
    expect(c.positions.added).toHaveLength(3);
    expect(c.units.removed).toEqual([]);
  });
});

describe("your manager, in the person's own menu", () => {
  const row = (positionId: string, name: string | null, vacant = false) => ({ positionId, titleAr: "المدير المالي", titleEn: "CFO", name, vacant });

  it("one line per position, the holders' names together, in the reader's language", () => {
    expect(yourManagers([row("m", "Nawaf"), row("m", "Sara")], "en")).toEqual([{ positionId: "m", title: "CFO", names: ["Nawaf", "Sara"], vacant: false }]);
    expect(yourManagers([row("m", null)], "ar")).toEqual([{ positionId: "m", title: "المدير المالي", names: [], vacant: false }]);
    expect(yourManagers([row("m", null, true)], "en")[0]!.vacant).toBe(true);
    expect(yourManagers([], "en")).toEqual([]);
  });

  it("has the words for a named manager, a hidden name and a vacancy, in both languages", () => {
    for (const messages of [ar, en]) {
      const t = createTranslator({ locale: messages === ar ? "ar" : "en", messages, namespace: "orgChart.yourManager" });
      expect(t("named", { title: "CFO", name: "Nawaf" })).toContain("Nawaf");
      expect(t("title", { title: "CFO" })).toContain("CFO");
      expect(t("vacant", { title: "CFO" })).toContain("CFO");
    }
  });
});

// The organisation structure drawn (org chart, part 2): the tree's layout
// helpers (order, depth, vacancies, advisory units, "reports to"), the one
// HTML drawing for the screen and the PDF, and its words in both languages.
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  fitZoom,
  ORG_CHART_CSS,
  orgTreeHtml,
  PDF_ROOT_PT,
  pdfPages,
  renderOrgChartPdfHtml,
  treeLabels,
  versionWords,
  wrapAt,
  type TreeLabels,
} from "@/lib/org-chart-html";
import {
  buildTree,
  chartLevels,
  compareCodes,
  overview,
  pageUnits,
  parseDepth,
  treeWidth,
  type ChartPositionIn,
  type ChartUnitIn,
  type TreeUnit,
} from "@/lib/org-chart-tree";
import { departmentTabs, versionStatus } from "@/lib/org-chart";
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
const held = (name: string | null, named = true) => ({ holders: [{ name, named }], vacant: false });

// A small structure in the firm's shape: the board, the chief executive with
// internal audit beside him, two departments, and a section inside one.
const UNITS: ChartUnitIn[] = [
  unit("1", null, "board", 1),
  unit("1.1", "1", "executive", 2),
  unit("1.1.3", "1.1", "department", 3, { sortOrder: 2, nameEn: "Finance" }),
  unit("1.1.1", "1.1", "unit", 3, { advisory: true, nameEn: "Internal audit" }),
  unit("1.1.2", "1.1", "department", 3, { sortOrder: 1, nameEn: "Legal" }),
  unit("1.1.3.1", "1.1.3", "section", 4, { nameEn: "Payables" }),
];
const POSITIONS: ChartPositionIn[] = [
  pos("chair", "1", { isHead: true, ...held("Hessa") }),
  pos("ceo", "1.1", { isHead: true, reportsToId: "chair", ...held("Nasser") }),
  pos("auditor", "1.1.1", { isHead: true, reportsToId: "chair", ...held(null, false) }),
  pos("cfo", "1.1.3", { isHead: true, reportsToId: "ceo", sortOrder: 5, ...held("Cfo") }),
  pos("analyst", "1.1.3", { reportsToId: "cfo", sortOrder: 1 }),
  pos("clerk", "1.1.3.1", { reportsToId: "cfo", sortOrder: 0, ...held("Clerk One") }),
  pos("counsel", "1.1.2", { isHead: true, reportsToId: "ceo", vacant: null }),
];
const tree = (opts: Partial<Parameters<typeof buildTree>[2]> = {}) => buildTree(UNITS, POSITIONS, { locale: "en", depth: null, names: true, ...opts });
const find = (roots: TreeUnit[], id: string): TreeUnit | undefined => {
  for (const r of roots) {
    if (r.id === id) return r;
    const hit = find([...r.beside, ...r.children], id);
    if (hit) return hit;
  }
  return undefined;
};

const labels = (locale: "ar" | "en"): TreeLabels => {
  const t = createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "orgChart" });
  return treeLabels((k, v) => t(k as "title", v as never));
};

describe("arranging the tree", () => {
  it("nests units by parent in the firm's order, codes read as numbers", () => {
    expect(compareCodes("2.9", "2.10")).toBeLessThan(0);
    expect(compareCodes("2", "2.1")).toBeLessThan(0);
    expect([...["1.10", "1.2", "1.1.5", "A", "1"]].sort(compareCodes)).toEqual(["1", "1.1.5", "1.2", "1.10", "A"]);
    const [board] = tree();
    expect(board!.name).toBe("Unit 1");
    const ceo = board!.children[0]!;
    // Legal (order 1) before Finance (order 2); internal audit is beside, not among them.
    expect(ceo.children.map((c) => c.name)).toEqual(["Legal", "Finance"]);
    expect(ceo.beside.map((c) => c.name)).toEqual(["Internal audit"]);
  });

  it("puts the head position first, then the firm's order", () => {
    const finance = find(tree(), "1.1.3")!;
    expect(finance.positions.map((p) => [p.id, p.head])).toEqual([
      ["cfo", true],
      ["analyst", false],
    ]);
  });

  it("spreads the governing levels across and stacks inside a department", () => {
    const roots = tree();
    expect(find(roots, "1")!.across).toBe(true);
    expect(find(roots, "1.1")!.across).toBe(true);
    expect(find(roots, "1.1.3")!.across).toBe(false);
    expect(find(roots, "1.1.3.1")!.across).toBe(false);
  });

  it("cuts at the depth chosen, always keeps the top, and says lower levels are left out", () => {
    expect(chartLevels(UNITS)).toEqual([1, 2, 3, 4]);
    const two = tree({ depth: 2 });
    expect(find(two, "1.1")!.children).toEqual([]);
    expect(find(two, "1.1")!.beside).toEqual([]);
    expect(find(two, "1.1")!.more).toBe("levels");
    expect(find(two, "1")!.more).toBeNull();
    const three = tree({ depth: 3 });
    expect(find(three, "1.1.3")!.children).toEqual([]);
    expect(find(three, "1.1.3")!.more).toBe("levels");
    expect(find(three, "1.1.2")!.more).toBeNull();
    // The top level is drawn whatever the depth.
    expect(buildTree([unit("x", null, "executive", 2)], [], { locale: "en", depth: 1, names: true }).map((u) => u.id)).toEqual(["x"]);
    // Only levels the structure has; the deepest is "every level".
    expect(parseDepth("2", [1, 2, 3, 4])).toBe(2);
    expect(parseDepth("4", [1, 2, 3, 4])).toBeNull();
    expect(parseDepth("7", [1, 2, 3, 4])).toBeNull();
    expect(parseDepth("all", [1, 2, 3, 4])).toBeNull();
    expect(parseDepth(undefined, [1, 2])).toBeNull();
  });

  it("puts an advisory unit beside its parent, or in line on a dotted line when nothing else hangs below", () => {
    const roots = tree();
    expect(find(roots, "1.1")!.beside.map((u) => [u.id, u.advisory])).toEqual([["1.1.1", true]]);
    // A chief executive with internal audit only: in line, still advisory.
    const alone = buildTree([unit("c", null, "executive", 1), unit("a", "c", "unit", 2, { advisory: true })], [], { locale: "en", depth: null, names: true });
    expect(alone[0]!.beside).toEqual([]);
    expect(alone[0]!.children.map((u) => [u.id, u.advisory])).toEqual([["a", true]]);
    // Inside a department it stacks with the others.
    const inDept = buildTree(
      [unit("d", null, "department", 1), unit("s", "d", "section", 2), unit("q", "d", "office", 2, { advisory: true, sortOrder: 1 })],
      [],
      { locale: "en", depth: null, names: true },
    );
    expect(inDept[0]!.beside).toEqual([]);
    expect(inDept[0]!.children.map((u) => u.id)).toEqual(["s", "q"]);
  });

  it("writes 'reports to' only for a line the drawing does not show", () => {
    const roots = tree();
    const reports = (unitId: string) => Object.fromEntries(find(roots, unitId)!.positions.map((p) => [p.id, p.reportsTo]));
    // The chief executive to the chair, the CFO to the chief executive, the analyst to the CFO: drawn.
    expect(reports("1.1")).toEqual({ ceo: null });
    expect(reports("1.1.3")).toEqual({ cfo: null, analyst: null });
    // Internal audit drawn beside the chief executive, reporting to the chair; the clerk's section has no head.
    expect(reports("1.1.1")).toEqual({ auditor: "Position chair" });
    expect(reports("1.1.3.1")).toEqual({ clerk: null });
    const elsewhere = buildTree(UNITS, POSITIONS.map((p) => (p.id === "clerk" ? { ...p, reportsToId: "ceo" } : p)), { locale: "ar", depth: null, names: true });
    expect(find(elsewhere, "1.1.3.1")!.positions[0]!.reportsTo).toBe("منصب ceo");
  });

  it("keeps the names the service sent and drops every one for a copy without names", () => {
    const roots = tree();
    expect(find(roots, "1")!.positions[0]!.names).toEqual(["Hessa"]);
    // Filled but not the reader's to name: no name, and not vacant either.
    expect(find(roots, "1.1.1")!.positions[0]).toMatchObject({ names: [], vacant: false });
    const without = tree({ names: false });
    const all = (us: TreeUnit[]): string[] => us.flatMap((u) => [...u.positions.flatMap((p) => p.names), ...all([...u.beside, ...u.children])]);
    expect(all(roots)).toEqual(["Hessa", "Nasser", "Cfo", "Clerk One"]);
    expect(all(without)).toEqual([]);
    // Vacancies stay: they are not names.
    expect(find(without, "1.1.3")!.positions.find((p) => p.id === "analyst")!.vacant).toBe(true);
  });

  it("finds the PDF's department pages and cuts them down to their head on the overview", () => {
    const roots = tree();
    const pages = pageUnits(roots);
    expect(pages.map((u) => u.id)).toEqual(["1.1.2", "1.1.3"]);
    const over = overview(roots, new Set(pages.map((u) => u.id)));
    const finance = find(over, "1.1.3")!;
    expect([finance.positions.map((p) => p.id), finance.children, finance.more]).toEqual([["cfo"], [], "page"]);
    // Internal audit stays whole on the overview.
    expect(find(over, "1.1.1")!.positions.map((p) => p.id)).toEqual(["auditor"]);
    // A chart with no department has no department pages.
    expect(pageUnits(tree({ depth: 2 }))).toEqual([]);
  });

  it("measures how wide a drawing is, to fit the printed page", () => {
    expect(treeWidth(tree())).toBe(2.3);
    expect(treeWidth(tree({ depth: 1 }))).toBe(1);
    expect(fitZoom(tree(), "a3")).toBe(1);
    const wide = buildTree(
      [unit("ceo", null, "executive", 1), ...Array.from({ length: 12 }, (_, i) => unit(`d${i}`, "ceo", "department", 2))],
      [],
      { locale: "en", depth: null, names: true },
    );
    expect(treeWidth(wide)).toBe(12);
    // In print the twelve wrap into rows (8 on A3, 4 on A4) instead of shrinking.
    expect([treeWidth(wide, 8), treeWidth(wide, 4)]).toEqual([8, 4]);
    expect(fitZoom(wide, "a4")).toBe(1);
    expect(fitZoom(wide, "a3")).toBeGreaterThanOrEqual(0.9);
  });
});

describe("the drawing", () => {
  it("is escaped HTML with no script, in the reading direction", () => {
    const evil = buildTree([unit("u", null, "board", 1, { nameEn: '<script>alert("x")</script>' })], [pos("p", "u", { titleEn: "<img src=x onerror=1>", ...held("<b>Name</b>") })], {
      locale: "en",
      depth: null,
      names: true,
    });
    const html = orgTreeHtml(evil, labels("en"), "en");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain('dir="ltr"');
    expect(orgTreeHtml(tree({ locale: "ar" }), labels("ar"), "ar")).toContain('dir="rtl" lang="ar"');
  });

  it("says Vacant / شاغر for a position nobody holds, nothing for titles only or a name the reader may not see", () => {
    const en = orgTreeHtml(tree(), labels("en"), "en");
    const arHtml = orgTreeHtml(tree({ locale: "ar" }), labels("ar"), "ar");
    // One vacancy: the analyst. Counsel is titles only; the auditor is filled without a name.
    expect(en.match(/class="oc-vacant"/g)).toHaveLength(1);
    expect(en).toContain('<p class="oc-vacant">Vacant</p>');
    expect(arHtml).toContain('<p class="oc-vacant">شاغر</p>');
    expect(en).toContain("Reports to: Position chair");
    expect(arHtml).toContain("يتبع: منصب chair");
  });

  it("draws advisory units on a dotted line, beside their parent", () => {
    const html = orgTreeHtml(tree(), labels("en"), "en");
    expect(html).toMatch(/<div class="oc-beside"><ul class="oc-beside-list"><li class="oc-adv">/);
    expect(html).toContain("(advisory unit)");
    expect(html).toContain('<ul class="oc-stack">');
    expect(html).not.toContain("Lower levels not shown");
    expect(orgTreeHtml(tree({ depth: 2 }), labels("en"), "en")).toContain("Lower levels not shown");
  });

  it("prints on A3 or A4 landscape, an overview page then one page per department", () => {
    const roots = tree();
    const pages = pageUnits(roots);
    const doc = (size: "a3" | "a4", locale: "ar" | "en" = "en") =>
      renderOrgChartPdfHtml({
        locale,
        size,
        clientName: "Nukhba <x>",
        title: "Organisation structure",
        meta: "Version 2",
        draftNotice: null,
        pages: [{ heading: null, roots: overview(roots, new Set(pages.map((p) => p.id))) }, ...pages.map((d) => ({ heading: d.name, roots: [d] }))],
        labels: labels(locale),
      });
    expect(doc("a3")).toContain("@page{size:A3 landscape;");
    expect(doc("a4")).toContain("@page{size:A4 landscape;");
    expect(doc("a3").match(/<section class="page">/g)).toHaveLength(3);
    expect(doc("a3")).toContain("<h1>Legal</h1>");
    expect(doc("a3")).toContain("Nukhba &lt;x&gt;");
    expect(doc("a3")).not.toMatch(/<script/i);
    expect(doc("a3")).not.toMatch(/(src|href)=["']?https?:/i);
    expect(doc("a3", "ar")).toContain('<html lang="ar" dir="rtl">');
  });
});

describe("printing a large structure readably", () => {
  const company = (departments: number, positionsInFirst = 1) =>
    buildTree(
      [unit("ceo", null, "executive", 1), ...Array.from({ length: departments }, (_, i) => unit(`d${i}`, "ceo", "department", 2, { sortOrder: i, nameEn: `Department ${i + 1}` }))],
      [
        pos("chief", "ceo", { isHead: true }),
        ...Array.from({ length: departments }, (_, i) => pos(`h${i}`, `d${i}`, { isHead: true })),
        ...Array.from({ length: positionsInFirst - 1 }, (_, j) => pos(`x${j}`, "d0", { sortOrder: j + 1, titleEn: `Employee ${j + 1}` })),
      ],
      { locale: "en", depth: null, names: true },
    );
  /** The size of the drawing's body text on paper, in points. */
  const textPt = (zoom: number) => 0.8125 * PDF_ROOT_PT * zoom;
  const rows = (html: string) => (html.match(/<ul class="oc-row( oc-wrap)?">/g) ?? []).length;

  it("wraps a long row of departments into rows, never shrinking the text below about 8 pt", () => {
    for (const [n, size, perRow] of [
      [12, "a3", 8],
      [16, "a4", 4],
      [25, "a3", 8],
      [40, "a4", 4],
    ] as const) {
      const pages = pdfPages(company(n), size);
      const over = pages[0]!.roots;
      const html = orgTreeHtml(over, labels("en"), "en", { wrap: wrapAt(size) });
      expect(wrapAt(size), `${n} on ${size}`).toBe(perRow);
      // The chief executive's departments, in rows of at most perRow: every row but the last says it continues.
      expect(rows(html), `${n} on ${size}`).toBe(Math.ceil(n / perRow));
      expect((html.match(/<ul class="oc-row oc-wrap">/g) ?? []).length).toBe(Math.ceil(n / perRow) - 1);
      expect(textPt(fitZoom(over, size)), `${n} on ${size}`).toBeGreaterThanOrEqual(8);
    }
    // A row that fits is not wrapped.
    expect(rows(orgTreeHtml(pdfPages(company(4), "a3")[0]!.roots, labels("en"), "en", { wrap: wrapAt("a3") }))).toBe(1);
  });

  it("an overview page, then one page per department, each with its own heading", () => {
    const pages = pdfPages(company(3), "a4");
    expect(pages.map((p) => p.heading)).toEqual([null, "Department 1", "Department 2", "Department 3"]);
  });

  it("a department with many positions lays them out in columns, its heading repeating on every page it runs to, a position never split", () => {
    const [, first] = pdfPages(company(2, 60), "a4");
    const html = orgTreeHtml(first!.roots, labels("en"), "en", { wrap: wrapAt("a4") });
    // A card is a table: its heading row repeats on each printed page; four positions to a row on A4.
    expect(html).toContain('<thead><tr><th colspan="4">');
    expect(html.match(/<tr class="oc-row-pos">/g)).toHaveLength(15);
    expect(ORG_CHART_CSS).toMatch(/\.oc-card tr\{[^}]*break-inside:avoid/);
    // A small card stays whole on one page.
    expect(orgTreeHtml(company(2), labels("en"), "en")).toContain('class="oc-unit oc-keep"');
  });

  it("every printed page repeats the client, the page's heading and the version at its top", () => {
    const pages = pdfPages(company(2, 60), "a4");
    const doc = renderOrgChartPdfHtml({
      locale: "en",
      size: "a4",
      clientName: "Acme",
      title: "Organisation structure",
      meta: "Version 2, current",
      draftNotice: null,
      pages,
      labels: labels("en"),
    });
    expect(doc.match(/<table class="frame"><thead><tr><td><header class="top">/g)).toHaveLength(3);
    expect(doc).toMatch(/\.frame thead\{display:table-header-group;/);
  });
});

describe("the client's Departments page tabs", () => {
  it("Structure only once there is one to read", () => {
    expect(departmentTabs({ admin: true, departmentsEnabled: true, structure: false })).toEqual(["departments"]);
    expect(departmentTabs({ admin: false, departmentsEnabled: true, structure: true })).toEqual(["departments", "structure"]);
  });

  it("departments off: a manager sees only the Structure; the client admin keeps both, the switch that turns departments on is on the Departments tab", () => {
    expect(departmentTabs({ admin: false, departmentsEnabled: false, structure: true })).toEqual(["structure"]);
    expect(departmentTabs({ admin: true, departmentsEnabled: false, structure: true })).toEqual(["departments", "structure"]);
    // Nothing published yet: the Departments page as before, for everyone.
    expect(departmentTabs({ admin: false, departmentsEnabled: false, structure: false })).toEqual(["departments"]);
  });
});

describe("what a version is on a day", () => {
  const v = (n: number | null, state: "draft" | "published" | "superseded", effectiveOn: string | null) => ({ id: `v${n ?? "d"}`, number: n, state, effectiveOn });
  const today = "2026-11-18";

  it("the draft is the draft; the published version whose day has come is current", () => {
    const all = [v(null, "draft", null), v(2, "published", "2026-10-01"), v(1, "superseded", "2025-01-01")];
    expect(versionStatus(all[0]!, all, today)).toEqual({ kind: "draft" });
    expect(versionStatus(all[1]!, all, today)).toEqual({ kind: "current" });
  });

  it("a replaced version says when and by which version", () => {
    const all = [v(3, "published", "2026-10-01"), v(2, "superseded", "2026-03-01"), v(1, "superseded", "2025-01-01")];
    expect(versionStatus(all[2]!, all, today)).toEqual({ kind: "past", replacedOn: "2026-03-01", by: 2 });
    expect(versionStatus(all[1]!, all, today)).toEqual({ kind: "past", replacedOn: "2026-10-01", by: 3 });
  });

  it("a version that takes effect later is not current: the one it replaces stays current until then", () => {
    const all = [v(2, "published", "2027-01-01"), v(1, "superseded", "2025-01-01")];
    expect(versionStatus(all[0]!, all, today)).toEqual({ kind: "upcoming", on: "2027-01-01" });
    expect(versionStatus(all[1]!, all, today)).toEqual({ kind: "current", until: "2027-01-01", by: 2 });
    // The day it takes effect, it is current, and the old one is replaced.
    expect(versionStatus(all[0]!, all, "2027-01-01")).toEqual({ kind: "current" });
    expect(versionStatus(all[1]!, all, "2027-01-01")).toEqual({ kind: "past", replacedOn: "2027-01-01", by: 2 });
  });

  it("a first version that takes effect later: nothing is current yet", () => {
    const all = [v(1, "published", "2027-01-01")];
    expect(versionStatus(all[0]!, all, today)).toEqual({ kind: "upcoming", on: "2027-01-01" });
  });
});

describe("the words, Arabic first", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "object" && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it("every org chart word exists in both languages", () => {
    expect(keys(ar.orgChart).sort()).toEqual(keys(en.orgChart).sort());
  });

  it("names the tabs and the vacancy as the decision says", () => {
    expect([ar.orgChart.tabs.structure, en.orgChart.tabs.structure]).toEqual(["الهيكل", "Structure"]);
    expect([ar.orgChart.clientTabs.structure, en.orgChart.clientTabs.structure]).toEqual(["الهيكل التنظيمي", "Structure"]);
    expect([ar.orgChart.tree.vacant, en.orgChart.tree.vacant]).toEqual(["شاغر", "Vacant"]);
  });

  it("speaks to the client about its own company, never about 'the client'", () => {
    for (const key of ["titleClient", "hintClient"] as const) {
      expect(ar.orgChart[key]).toMatch(/شركتكم/);
      expect(ar.orgChart[key]).not.toContain("العميل");
      expect(en.orgChart[key]).toMatch(/your company/i);
      expect(en.orgChart[key]).not.toMatch(/\bthe client\b/i);
    }
    for (const key of ["branch", "hidden", "history", "noDepartment"] as const) {
      expect(ar.orgChart.names[key]).not.toContain("العميل");
      expect(en.orgChart.names[key]).not.toMatch(/\bthe client\b/i);
    }
  });

  it("promises no action the app does not have yet (starting or publishing a structure comes with its buttons)", () => {
    for (const messages of [ar, en]) {
      const all = JSON.stringify(messages.orgChart);
      expect(all).not.toMatch(/can start one|publishes this draft|until it is published|يستطيع البدء|حتى ينشر|حتى تُنشر/);
    }
  });

  it("the firm's line under the title holds for any version shown, the draft too", () => {
    expect(en.orgChart.hint).not.toMatch(/published/i);
    expect(ar.orgChart.hint).not.toContain("المنشور");
  });

  it("tells a manager why she sees no names when her company does not use departments", () => {
    expect(ar.orgChart.names.departmentsOff).toContain("لا تعمل بالإدارات");
    expect(en.orgChart.names.departmentsOff).toMatch(/does not use departments/);
  });

  it("never scores or judges a structure", () => {
    const all = JSON.stringify([ar.orgChart, en.orgChart]);
    expect(all).not.toMatch(/span of control|نطاق الإشراف|healthy|unhealthy|too many|good structure|سليم|ضعيف/i);
  });

  it("says which version it is, in both languages: current, upcoming, or replaced on a day by which version and whose holders", () => {
    const words = (locale: "ar" | "en") => {
      const t = createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "orgChart" });
      const tr = (k: string, v?: Record<string, string | number>) => t(k as "title", v as never);
      return (status: Parameters<typeof versionWords>[1], asOf: string | null = null) => versionWords({ number: 1, effectiveOn: "2025-01-01" }, status, asOf, tr, (d) => d).join(" · ");
    };
    expect(words("ar")({ kind: "current" })).toBe("الإصدار 1، الحالي · نافذ من 2025-01-01");
    expect(words("en")({ kind: "current", until: "2027-01-01", by: 2 })).toBe("Version 1, current · In effect from 2025-01-01 · Version 2 takes effect on 2027-01-01");
    expect(words("ar")({ kind: "past", replacedOn: "2026-03-01", by: 2 }, "2026-02-20")).toBe(
      "الإصدار 1 · نافذ من 2025-01-01 · حلّ محله الإصدار 2 في 2026-03-01 · شاغلو المناصب كما كانوا في 2026-02-20",
    );
    expect(words("en")({ kind: "past", replacedOn: "2026-03-01", by: 2 })).toBe("Version 1 · In effect from 2025-01-01 · Replaced on 2026-03-01 by version 2");
    expect(words("en")({ kind: "upcoming", on: "2027-01-01" })).toBe("Version 1 · Takes effect on 2027-01-01");
    expect(words("ar")({ kind: "draft" })).toBe("مسودة غير منشورة");
  });
});

// Org chart, part 4: the ways in (lib/org-chart-import.ts). The Excel
// template's headings in both languages, its rows, a Word outline, the
// assistant's draft from pasted text (it never adds a position), and every
// check of the review step, run the same in the browser and on the server.
// Selah records the structure the firm decides: nothing here judges one.
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readDocx } from "@/lib/office/docx-read";
import { readXlsx } from "@/lib/office/xlsx-read";
import { writeXlsx } from "@/lib/office/xlsx-write";
import { ORG_UNIT_KINDS } from "@/lib/org-chart";
import {
  checkOrgImport,
  draftRows,
  fieldOfHeader,
  fillCodes,
  findTemplateSheet,
  guessKind,
  ORG_IMPORT_FIELDS,
  ORG_IMPORT_LIMITS,
  outlineRows,
  parseKind,
  parseYesNo,
  sheetRows,
  splitList,
  structureRows,
  type DraftReply,
  type OrgImportContext,
  type OrgRow,
  type OrgValues,
} from "@/lib/org-chart-import";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const people = [
  { userId: "u-reem", email: "reem@sahm.example", name: "Reem Al-Harbi" },
  { userId: "u-khalid", email: "khalid@sahm.example", name: "خالد العتيبي" },
];
const ctx = (over: Partial<OrgImportContext> = {}): OrgImportContext => ({ minimalRecords: false, people, draft: { units: [], positions: [] }, ...over });
const row = (line: number, values: OrgValues, include = true): OrgRow => ({ line, include, values, filled: [] });

/** A three-level structure like the firm's usual slide, in both languages, with ";" and "؛". */
const sample = (): OrgRow[] => [
  row(2, { unitCode: "1", unitNameAr: "مجلس الإدارة", unitNameEn: "Board of Directors", unitKind: "board", level: "1", positionCode: "1.1", titleAr: "رئيس مجلس الإدارة", titleEn: "Chair", head: "yes" }),
  row(3, { unitCode: "2", unitNameAr: "الرئيس التنفيذي", unitKind: "تنفيذي", parentCode: "1", level: "2", positionCode: "2.1", titleEn: "Chief Executive Officer", reportsTo: "1.1", head: "نعم", holder: "REEM@sahm.example" }),
  row(4, {
    unitCode: "2.1",
    unitNameAr: "الإدارة المالية",
    unitNameEn: "Finance",
    unitKind: "إدارة",
    parentCode: "2",
    level: "3",
    positionCode: "2.1.1",
    titleAr: "مدير الإدارة المالية",
    reportsTo: "2.1",
    head: "yes",
    holder: "نواف القاسمي",
    specialties: "الميزانية؛ التقارير المالية; treasury",
  }),
  row(5, { unitCode: "2.1", positionCode: "2.1.2", titleAr: "محاسب", reportsTo: "2.1.1", vacant: "نعم", planned: "3" }),
  row(6, { unitCode: "2.2", unitNameEn: "Internal audit", unitKind: "unit", parentCode: "1", level: "2", advisory: "yes" }),
];
const at = (c: ReturnType<typeof checkOrgImport>, line: number) => c.rows.find((r) => r.line === line)!;
const errorsAt = (c: ReturnType<typeof checkOrgImport>, line: number) => at(c, line).errors.map((i) => i.code);
const notesAt = (c: ReturnType<typeof checkOrgImport>, line: number) => at(c, line).notes.map((i) => i.code);
const edit = (rows: OrgRow[], line: number, values: OrgValues) => rows.map((r) => (r.line === line ? { ...r, values: { ...r.values, ...values } } : r));

describe("the template's headings", () => {
  it("maps every column of the template back to its field, in Arabic and in English", () => {
    for (const m of [ar, en]) {
      for (const f of ORG_IMPORT_FIELDS) expect(fieldOfHeader(m.orgChartImport.fields[f]), f).toBe(f);
    }
  });

  it("reads a heading cell that holds both languages, one per line, and common other wordings", () => {
    expect(fieldOfHeader(`${ar.orgChartImport.fields.reportsTo}\n${en.orgChartImport.fields.reportsTo}`)).toBe("reportsTo");
    expect(fieldOfHeader("Job title")).toBe("titleEn");
    expect(fieldOfHeader("المسمى الوظيفي")).toBe("titleAr");
    expect(fieldOfHeader("اسم الوحدة")).toBe("unitNameAr");
    expect(fieldOfHeader("Notes")).toBeNull();
  });

  it("finds the structure sheet and skips the guide sheet", () => {
    const headers = ORG_IMPORT_FIELDS.map((f) => `${ar.orgChartImport.fields[f]}\n${en.orgChartImport.fields[f]}`);
    const guide = { name: "Guide", rows: [["Column", "What to write"], ...ORG_IMPORT_FIELDS.map((f) => [en.orgChartImport.fields[f], "..."])] };
    const sheet = { name: "Structure", rows: [["A title above the table"], headers, ["1", "مجلس الإدارة"]] };
    const found = findTemplateSheet([guide, sheet]);
    expect(found?.sheet.name).toBe("Structure");
    expect(found?.headerRow).toBe(1);
    expect(found?.mapping).toEqual([...ORG_IMPORT_FIELDS]);
    expect(findTemplateSheet([guide])).toBeNull();
  });
});

describe("reading the rows", () => {
  it("splits lists on ';', '؛' and new lines", () => {
    expect(splitList("الميزانية؛ التقارير المالية; treasury\naudit ; ")).toEqual(["الميزانية", "التقارير المالية", "treasury", "audit"]);
    expect(splitList(undefined)).toEqual([]);
  });

  it("reads yes and no, and the unit kinds, in both languages", () => {
    expect([parseYesNo("yes"), parseYesNo("Y"), parseYesNo("نعم"), parseYesNo("✓"), parseYesNo("No"), parseYesNo("لا"), parseYesNo(""), parseYesNo("maybe")]).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      undefined,
      null,
    ]);
    for (const k of ORG_UNIT_KINDS) {
      expect(parseKind(k)).toBe(k);
      expect(parseKind(ar.orgChartImport.kinds[k])).toBe(k);
      expect(parseKind(en.orgChartImport.kinds[k])).toBe(k);
    }
    expect(parseKind("directorate of things")).toBeNull();
    expect(guessKind("مجلس الإدارة")).toBe("board");
    expect(guessKind("لجنة المراجعة")).toBe("committee");
    expect(guessKind("مكتب الرئيس التنفيذي")).toBe("executive");
    expect(guessKind("قطاع العمليات")).toBe("sector");
    expect(guessKind("الإدارة المالية")).toBe("department");
    expect(guessKind("Procurement Section")).toBe("section");
    expect(guessKind("Internal audit")).toBeNull();
  });

  it("takes a sheet's rows under the mapping, skips blank rows and fills a position's unit from the row above", () => {
    const mapping = ["unitCode", "unitNameAr", "positionCode", "titleAr", null] as const;
    const rows = sheetRows(
      [
        ["رمز الوحدة", "اسم الوحدة", "رمز الوظيفة", "المسمى", "notes"],
        ["٢.١", "الإدارة المالية", "2.1.1", "مدير", "x"],
        ["", "", "2.1.2", "محاسب", ""],
        [],
        ["2.2", "الموارد البشرية", "", "", ""],
      ],
      0,
      [...mapping],
    );
    expect(rows.map((r) => [r.line, r.values, r.filled])).toEqual([
      [2, { unitCode: "٢.١", unitNameAr: "الإدارة المالية", positionCode: "2.1.1", titleAr: "مدير" }, []],
      [3, { unitCode: "٢.١", positionCode: "2.1.2", titleAr: "محاسب" }, ["unitCode"]],
      [5, { unitCode: "2.2", unitNameAr: "الموارد البشرية" }, []],
    ]);
  });

  it("gives codes to rows that have none, under their parent and avoiding the draft's", () => {
    const rows = fillCodes(
      [row(2, { unitNameEn: "Finance" }), row(3, { unitNameEn: "Finance", titleEn: "Director" }), row(4, { titleEn: "Accountant" }), row(5, { unitNameEn: "Budgets", parentCode: "1" })],
      { units: new Set(["1"]), positions: new Set() },
    );
    expect(rows.map((r) => [r.values.unitCode, r.values.positionCode, r.filled])).toEqual([
      ["2", undefined, ["unitCode"]],
      ["2", "2.1", ["unitCode", "positionCode"]],
      ["2", "2.2", ["unitCode", "positionCode"]],
      ["1.1", undefined, ["unitCode"]],
    ]);
  });
});

describe("the review step's checks", () => {
  it("passes a consistent structure and plans it: holders by e-mail become the person, other text a typed name", () => {
    const c = checkOrgImport(sample(), ctx(), "add");
    expect(c.rows.flatMap((r) => r.errors)).toEqual([]);
    expect(c.plan.units.map((u) => [u.code, u.kind, u.parentCode, u.level, u.advisory])).toEqual([
      ["1", "board", null, 1, false],
      ["2", "executive", "1", 2, false],
      ["2.1", "department", "2", 3, false],
      ["2.2", "unit", "1", 2, true],
    ]);
    const byCode = Object.fromEntries(c.plan.positions.map((p) => [p.code, p]));
    expect(byCode["2.1"]!.holders).toEqual([{ userId: "u-reem" }]);
    expect(byCode["2.1.1"]!.holders).toEqual([{ name: "نواف القاسمي" }]);
    expect(byCode["2.1.1"]!.specialties).toEqual(["الميزانية", "التقارير المالية", "treasury"]);
    expect(byCode["2.1.2"]).toMatchObject({ holders: [], plannedCount: 3, reportsTo: "2.1.1", isHead: false, unitCode: "2.1" });
    expect(c.counts).toMatchObject({ units: 4, positions: 4, withErrors: 0 });
  });

  it("flags a parent unit code that does not exist", () => {
    const c = checkOrgImport(edit(sample(), 4, { parentCode: "9" }), ctx(), "add");
    expect(errorsAt(c, 4)).toEqual(["unknownParent"]);
  });

  it("flags a 'reports to' code that does not exist, and a title written where a code belongs", () => {
    const c = checkOrgImport(edit(edit(sample(), 4, { reportsTo: "7.7" }), 5, { reportsTo: "مدير الإدارة المالية" }), ctx(), "add");
    expect(errorsAt(c, 4)).toEqual(["unknownReportsTo"]);
    expect(errorsAt(c, 5)).toEqual(["badCode"]);
  });

  it("flags a loop in 'reports to', through others or to itself, and in the units", () => {
    const loop = checkOrgImport(edit(sample(), 2, { reportsTo: "2.1.2" }), ctx(), "add");
    for (const line of [2, 3, 4, 5]) expect(errorsAt(loop, line)).toContain("loop");
    const self = checkOrgImport(edit(sample(), 5, { reportsTo: "2.1.2" }), ctx(), "add");
    expect(errorsAt(self, 5)).toEqual(["loop"]);
    expect(errorsAt(self, 4)).toEqual([]);
    const units = checkOrgImport(edit(edit(sample(), 2, { parentCode: "2.1" }), 2, { level: "4" }), ctx(), "add");
    expect(errorsAt(units, 2)).toContain("unitLoop");
    expect(errorsAt(units, 4)).toContain("unitLoop");
  });

  it("flags a duplicate code: a position code twice, a unit code for two different units", () => {
    const c = checkOrgImport(edit(edit(sample(), 5, { positionCode: "2.1.1", reportsTo: "2.1" }), 6, { unitCode: "2.1" }), ctx(), "add");
    expect(errorsAt(c, 4)).toEqual(["duplicatePosition"]);
    expect(errorsAt(c, 5)).toEqual(["duplicatePosition"]);
    expect(errorsAt(c, 6)).toEqual(["duplicateUnit"]);
    expect(at(c, 5).errors[0]!.values).toMatchObject({ code: "2.1.1", line: 4 });
  });

  it("flags a missing title and a unit without a name", () => {
    const c = checkOrgImport(edit(edit(sample(), 5, { titleAr: "" }), 6, { unitNameEn: "" }), ctx(), "add");
    expect(errorsAt(c, 5)).toEqual(["noTitle"]);
    expect(errorsAt(c, 6)).toEqual(["noUnitName"]);
  });

  it("flags a holder e-mail that is not a person of this client with an account", () => {
    const c = checkOrgImport(edit(sample(), 3, { holder: "someone@elsewhere.example" }), ctx(), "add");
    expect(errorsAt(c, 3)).toEqual(["holderNotUser"]);
    expect(at(c, 3).errors[0]!.values).toEqual({ value: "someone@elsewhere.example" });
    // A name that happens to be a person's stays a typed name: only an e-mail picks the account.
    const named = checkOrgImport(edit(sample(), 3, { holder: "Reem Al-Harbi" }), ctx(), "add");
    expect(named.plan.positions.find((p) => p.code === "2.1")!.holders).toEqual([{ name: "Reem Al-Harbi" }]);
  });

  it("flags a level that does not match the parent, and fills an empty one", () => {
    const c = checkOrgImport(edit(sample(), 4, { level: "2" }), ctx(), "add");
    expect(errorsAt(c, 4)).toEqual(["levelParent"]);
    expect(at(c, 4).errors[0]!.values).toEqual({ level: 2, parent: 2 });
    expect(errorsAt(checkOrgImport(edit(sample(), 4, { level: "13" }), ctx(), "add"), 4)).toEqual(["badLevel"]);
    expect(errorsAt(checkOrgImport(edit(sample(), 4, { level: "ثلاثة" }), ctx(), "add"), 4)).toEqual(["badLevel"]);
    const filled = checkOrgImport(edit(sample(), 4, { level: "" }), ctx(), "add");
    expect(filled.plan.units.find((u) => u.code === "2.1")!.level).toBe(3);
    expect(notesAt(filled, 4)).toContain("levelGiven");
  });

  it("flags a vacant position that names a holder, more holders than planned, and two heads in one unit", () => {
    expect(errorsAt(checkOrgImport(edit(sample(), 5, { holder: "Someone" }), ctx(), "add"), 5)).toEqual(["holderAndVacant"]);
    expect(errorsAt(checkOrgImport(edit(sample(), 4, { holder: "A person; Another person" }), ctx(), "add"), 4)).toEqual(["tooManyHolders"]);
    expect(errorsAt(checkOrgImport(edit(sample(), 5, { head: "yes" }), ctx(), "add"), 5)).toEqual(["twoHeads"]);
  });

  it("flags values it cannot read: a kind, a yes or no, a planned number, a code, specialties, lengths", () => {
    const c = checkOrgImport(
      edit(edit(edit(sample(), 4, { unitKind: "directorate of things", head: "perhaps" }), 5, { planned: "0" }), 6, { unitCode: "٢/٢" }),
      ctx(),
      "add",
    );
    expect(errorsAt(c, 4)).toEqual(["badKind", "badYesNo"]);
    expect(errorsAt(c, 5)).toEqual(["badPlanned"]);
    expect(errorsAt(c, 6)).toEqual(["badCode"]);
    const many = Array.from({ length: 31 }, (_, i) => `s${i}`).join(";");
    expect(errorsAt(checkOrgImport(edit(sample(), 5, { specialties: many }), ctx(), "add"), 5)).toEqual(["specialties"]);
    expect(errorsAt(checkOrgImport(edit(sample(), 5, { titleAr: "م".repeat(201) }), ctx(), "add"), 5)).toEqual(["tooLong"]);
  });

  it("flags a position with no unit, or a unit that is nowhere", () => {
    const c = checkOrgImport([...sample(), row(7, { positionCode: "7.1", titleEn: "Driver" }), row(8, { unitCode: "5", positionCode: "5.1", titleEn: "Clerk" })], ctx(), "add");
    expect(errorsAt(c, 7)).toEqual(["noUnit"]);
    expect(errorsAt(c, 8)).toEqual(["unknownUnit"]);
  });

  it("reads codes written in Arabic digits as the same codes", () => {
    const c = checkOrgImport(edit(sample(), 5, { unitCode: "٢.١", reportsTo: "٢.١.١" }), ctx(), "add");
    expect(errorsAt(c, 5)).toEqual([]);
    expect(c.plan.positions.find((p) => p.code === "2.1.2")).toMatchObject({ unitCode: "2.1", reportsTo: "2.1.1" });
  });

  it("checks only the rows kept: a row left out is not saved and nothing may point to it", () => {
    const rows = sample().map((r) => (r.line === 4 ? { ...r, include: false } : r));
    const c = checkOrgImport(rows, ctx(), "add");
    expect(c.rows.map((r) => r.line)).toEqual([2, 3, 5, 6]);
    expect(errorsAt(c, 5)).toEqual(["unknownUnit", "unknownReportsTo"]);
  });

  it("keeps no names at a client with minimal records", () => {
    const c = checkOrgImport(sample(), ctx({ minimalRecords: true }), "add");
    expect(c.rows.flatMap((r) => r.errors)).toEqual([]);
    expect(c.plan.positions.every((p) => p.holders.length === 0)).toBe(true);
    expect(notesAt(c, 3)).toContain("namesNotKept");
    expect(notesAt(c, 4)).toContain("namesNotKept");
  });

  it("refuses more rows than one import takes", () => {
    const rows = Array.from({ length: ORG_IMPORT_LIMITS.rows + 1 }, (_, i) => row(i + 2, { unitCode: String(i + 1), unitNameEn: `Unit ${i + 1}` }));
    expect(checkOrgImport(rows, ctx(), "add").tooMany).toBe(true);
    expect(checkOrgImport(rows.slice(1), ctx(), "add").tooMany).toBe(false);
  });

  describe("against the draft", () => {
    const draft: OrgImportContext["draft"] = {
      units: [
        { code: "1", parentCode: null, level: 1, nameAr: "مجلس الإدارة", nameEn: null, kind: "board", advisory: false },
        { code: "9", parentCode: "1", level: 2, nameAr: null, nameEn: "Old unit", kind: "unit", advisory: false },
      ],
      positions: [
        { code: "1.1", unitCode: "1", reportsTo: null, isHead: true, titleAr: "رئيس المجلس", titleEn: null, holders: [{ userId: "u-khalid", name: null }] },
        { code: "9.1", unitCode: "9", reportsTo: "1.1", isHead: false, titleAr: null, titleEn: "Old position", holders: [] },
      ],
    };

    it("adding: a row may use the draft's units and positions by code, but not reuse a position code", () => {
      const rows = [row(2, { unitCode: "1", positionCode: "1.2", titleEn: "Secretary", reportsTo: "1.1" }), row(3, { unitCode: "3", unitNameEn: "Legal", parentCode: "9", level: "3" })];
      const c = checkOrgImport(rows, ctx({ draft }), "add");
      expect(c.rows.flatMap((r) => r.errors)).toEqual([]);
      expect(notesAt(c, 2)).toContain("unitInDraft");
      expect(c.plan.removeUnits).toEqual([]);
      const taken = checkOrgImport([row(2, { unitCode: "1", positionCode: "1.1", titleEn: "Chair" })], ctx({ draft }), "add");
      expect(errorsAt(taken, 2)).toEqual(["positionInDraft"]);
      const head = checkOrgImport([row(2, { unitCode: "1", positionCode: "1.2", titleEn: "Co-chair", head: "yes" })], ctx({ draft }), "add");
      expect(errorsAt(head, 2)).toEqual(["headInDraft"]);
      // The draft's own lines count for a loop.
      const loop = checkOrgImport([row(2, { unitCode: "1", positionCode: "1.2", titleEn: "X", reportsTo: "9.1" })], ctx({ draft: { ...draft, positions: draft.positions.map((p) => (p.code === "1.1" ? { ...p, reportsTo: "1.2" } : p)) } }), "add");
      expect(errorsAt(loop, 2)).toEqual(["loop"]);
    });

    it("replacing: codes in the draft are updated, the rest of the draft is removed, and only these rows count", () => {
      const rows = [
        row(2, { unitCode: "1", unitNameAr: "مجلس الإدارة", unitKind: "board", positionCode: "1.1", titleAr: "رئيس المجلس", head: "yes", holder: "Someone new" }),
        row(3, { unitCode: "3", unitNameEn: "Legal", parentCode: "9", level: "2" }),
      ];
      const c = checkOrgImport(rows, ctx({ draft }), "replace");
      expect(errorsAt(c, 3)).toEqual(["unknownParent"]);
      const ok = checkOrgImport(edit(rows, 3, { parentCode: "1" }), ctx({ draft }), "replace");
      expect(ok.rows.flatMap((r) => r.errors)).toEqual([]);
      expect(notesAt(ok, 2)).toEqual(expect.arrayContaining(["unitUpdated", "positionUpdated"]));
      expect(ok.plan.units.map((u) => [u.code, u.inDraft])).toEqual([
        ["1", true],
        ["3", false],
      ]);
      expect(ok.plan.positions.map((p) => [p.code, p.inDraft])).toEqual([["1.1", true]]);
      expect(ok.plan.removeUnits).toEqual(["9"]);
      expect(ok.plan.removePositions).toEqual(["9.1"]);
    });
  });

  it("never judges the structure: a wide unit and a deep chain are simply recorded", () => {
    const wide = [
      row(2, { unitCode: "1", unitNameEn: "Team", positionCode: "1.0", titleEn: "Head", head: "yes" }),
      ...Array.from({ length: 40 }, (_, i) => row(i + 3, { unitCode: "1", positionCode: `1.${i + 1}`, titleEn: `Officer ${i + 1}`, reportsTo: "1.0" })),
    ];
    const deep = Array.from({ length: 12 }, (_, i) => row(i + 2, { unitCode: `D${i + 1}`, unitNameEn: `Level ${i + 1}`, parentCode: i ? `D${i}` : "", level: String(i + 1) }));
    for (const rows of [wide, deep]) {
      const c = checkOrgImport(rows, ctx(), "add");
      expect(c.rows.flatMap((r) => r.errors)).toEqual([]);
      // Facts only: no note about how wide or deep a structure is.
      expect(new Set(c.rows.flatMap((r) => r.notes.map((n) => n.code)))).toEqual(new Set(["kindDefault"]));
    }
  });
});

describe("a Word outline", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const styles = `<?xml version="1.0"?><w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
    <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>
  </w:styles>`;
  const p = (style: string | null, text: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const docx = (body: string) =>
    readDocx(zipSync({ "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`), "word/styles.xml": strToU8(styles) }));

  it("makes Heading 1, 2 and 3 units at levels 1, 2 and 3, and the bullets under them positions", () => {
    const blocks = docx(
      [
        p("Heading1", "مجلس الإدارة"),
        p("ListBullet", "رئيس مجلس الإدارة"),
        p(null, "يجتمع المجلس أربع مرات في السنة."),
        p("Heading2", "الرئيس التنفيذي"),
        p("Heading3", "2.4 الإدارة المالية"),
        p("ListBullet", "مدير الإدارة المالية"),
        p("ListBullet", "Accountant"),
        p("Heading2", "Internal Audit"),
        p("Heading1", "١. Shareholders' assembly"),
      ].join(""),
    );
    const rows = outlineRows(blocks, { units: new Set(), positions: new Set() });
    expect(rows.map((r) => r.values)).toEqual([
      { unitCode: "1", unitNameAr: "مجلس الإدارة", parentCode: "", level: "1" },
      { unitCode: "1", positionCode: "1.1", titleAr: "رئيس مجلس الإدارة" },
      { unitCode: "1.1", unitNameAr: "الرئيس التنفيذي", parentCode: "1", level: "2" },
      { unitCode: "2.4", unitNameAr: "الإدارة المالية", parentCode: "1.1", level: "3" },
      { unitCode: "2.4", positionCode: "2.4.1", titleAr: "مدير الإدارة المالية" },
      { unitCode: "2.4", positionCode: "2.4.2", titleEn: "Accountant" },
      { unitCode: "1.2", unitNameEn: "Internal Audit", parentCode: "1", level: "2" },
      { unitCode: "2", unitNameEn: "Shareholders' assembly", parentCode: "", level: "1" },
    ]);
    const c = checkOrgImport(rows, ctx(), "add");
    expect(c.rows.flatMap((r) => r.errors)).toEqual([]);
    expect(c.plan.units.map((u) => [u.code, u.kind, u.level, u.parentCode])).toEqual([
      ["1", "board", 1, null],
      ["1.1", "executive", 2, "1"],
      ["2.4", "department", 3, "1.1"],
      ["1.2", "unit", 2, "1"],
      ["2", "unit", 1, null],
    ]);
  });
});

describe("the round trip: the template exports a structure and imports it back the same", () => {
  const units = [
    { id: "u1", parentId: null, kind: "board" as const, code: "1", nameAr: "مجلس الإدارة", nameEn: "Board", level: 1, sortOrder: 0, advisory: false },
    { id: "u2", parentId: "u1", kind: "executive" as const, code: "2", nameAr: "الرئيس التنفيذي", nameEn: null, level: 2, sortOrder: 0, advisory: false },
    { id: "u4", parentId: "u2", kind: "department" as const, code: "2.1", nameAr: "الإدارة المالية", nameEn: "Finance", level: 4, sortOrder: 0, advisory: false },
    { id: "u3", parentId: "u1", kind: "unit" as const, code: "2.9", nameAr: null, nameEn: "Internal audit", level: 2, sortOrder: 1, advisory: true },
  ];
  const positions = [
    { id: "p1", unitId: "u1", code: "1.1", titleAr: "رئيس المجلس", titleEn: "Chair", reportsToId: null, isHead: true, specialties: [], plannedCount: 1, sortOrder: 0, holders: [{ userId: null, name: "نواف القاسمي", named: true }], vacant: false },
    { id: "p2", unitId: "u2", code: "2.1", titleAr: "الرئيس التنفيذي", titleEn: null, reportsToId: "p1", isHead: true, specialties: ["الاستراتيجية", "Board relations"], plannedCount: 1, sortOrder: 0, holders: [{ userId: "u-reem", name: "Reem Al-Harbi", named: true }], vacant: false },
    { id: "p3", unitId: "u4", code: "2.1.1", titleAr: "محاسب", titleEn: "Accountant", reportsToId: "p2", isHead: false, specialties: [], plannedCount: 3, sortOrder: 0, holders: [{ userId: null, name: "Two Holder", named: true }, { userId: "u-khalid", name: "خالد العتيبي", named: true }], vacant: false },
    { id: "p4", unitId: "u4", code: "2.1.2", titleAr: "مدقق", titleEn: null, reportsToId: "p2", isHead: false, specialties: [], plannedCount: 1, sortOrder: 1, holders: [], vacant: true },
  ];
  const email = new Map(people.map((p) => [p.userId, p.email]));

  for (const [locale, messages] of [["ar", ar], ["en", en]] as const) {
    it(`in ${locale === "ar" ? "Arabic" : "English"}`, () => {
      const headers = ORG_IMPORT_FIELDS.map((f) => `${messages.orgChartImport.fields[f]}\n${(locale === "ar" ? en : ar).orgChartImport.fields[f]}`);
      const body = structureRows(units, positions, { locale, names: true, holderText: (h) => (h.userId ? (email.get(h.userId) ?? null) : h.name) });
      const bytes = writeXlsx([{ name: "Structure", rtl: locale === "ar", columns: headers.map((header) => ({ header })), rows: body }]);
      const found = findTemplateSheet(readXlsx(bytes))!;
      const rows = sheetRows(found.sheet.rows, found.headerRow, found.mapping);
      const c = checkOrgImport(rows, ctx(), "add");
      expect(c.rows.flatMap((r) => r.errors)).toEqual([]);
      const code = new Map(units.map((u) => [u.id, u.code]));
      const pcode = new Map(positions.map((p) => [p.id, p.code]));
      expect(c.plan.units.map(({ code, nameAr, nameEn, kind, parentCode, level, advisory }) => ({ code, nameAr, nameEn, kind, parentCode, level, advisory }))).toEqual(
        units.map((u) => ({ code: u.code, nameAr: u.nameAr, nameEn: u.nameEn, kind: u.kind, parentCode: u.parentId ? code.get(u.parentId) : null, level: u.level, advisory: u.advisory })),
      );
      expect(
        c.plan.positions.map(({ code, unitCode, titleAr, titleEn, reportsTo, isHead, specialties, plannedCount, holders }) => ({ code, unitCode, titleAr, titleEn, reportsTo, isHead, specialties, plannedCount, holders })),
      ).toEqual(
        positions.map((p) => ({
          code: p.code,
          unitCode: code.get(p.unitId),
          titleAr: p.titleAr,
          titleEn: p.titleEn,
          reportsTo: p.reportsToId ? pcode.get(p.reportsToId) : null,
          isHead: p.isHead,
          specialties: p.specialties,
          plannedCount: p.plannedCount,
          holders: p.holders.map((h) => (h.userId ? { userId: h.userId } : { name: h.name })),
        })),
      );
    });
  }

  it("leaves names out of a copy without names, and says nothing about who holds a position where the reader gets titles only", () => {
    const holder = ORG_IMPORT_FIELDS.indexOf("holder");
    const vacant = ORG_IMPORT_FIELDS.indexOf("vacant");
    const without = structureRows(units, positions, { locale: "en", names: false, holderText: (h) => h.name });
    expect(without.every((r) => !r[holder])).toBe(true);
    expect(without.map((r) => r[vacant]).filter(Boolean)).toEqual(["no", "no", "no", "yes"]);
    const titlesOnly = structureRows(units, positions.map((p) => ({ ...p, holders: [], vacant: null })), { locale: "ar", names: true, holderText: (h) => h.name });
    expect(titlesOnly.every((r) => !r[holder] && !r[vacant])).toBe(true);
  });
});

describe("the assistant's draft never adds a position, and never handles people", () => {
  const text = [
    "Finance department: the Finance Manager (Nawaf Al-Qasimi) leads it and handles budgets.",
    "An Accountant reports to the Finance Manager.",
    "الموارد البشرية: مدير الموارد البشرية والأخصائي",
  ].join("\n");
  const reply: DraftReply = {
    units: [
      { ref: "U1", parent: "", code: "", name: "Finance department", kind: "department" },
      { ref: "U2", parent: "", code: "", name: "Procurement", kind: "department" },
      { ref: "U3", parent: "", code: "", name: "الموارد البشرية", kind: "department" },
    ],
    positions: [
      // A model that writes a person anyway: the draft never takes it.
      { ref: "P1", unit: "U1", code: "", title: "Finance Manager", reports_to: "", head: true, specialties: ["budgets", "payroll"], ...({ holder: "Nawaf Al-Qasimi" } as object) },
      { ref: "P2", unit: "U1", code: "", title: "Accountant", reports_to: "P1", head: false, specialties: [] },
      { ref: "P3", unit: "U1", code: "", title: "Accountant", reports_to: "P1", head: false, specialties: [] },
      { ref: "P4", unit: "U2", code: "", title: "Procurement Officer", reports_to: "", head: false, specialties: [] },
      { ref: "P5", unit: "U1", code: "", title: "Finance Manager", reports_to: "", head: false, specialties: [] },
      { ref: "P6", unit: "U3", code: "", title: "مدير الموارد البشرية", reports_to: "", head: true, specialties: [] },
      { ref: "P7", unit: "U3", code: "", title: "الأخصائي", reports_to: "P6", head: false, specialties: [] },
    ],
  };

  it("keeps what is in the text, and drops and flags anything else", () => {
    const { rows, dropped } = draftRows(reply, text, { units: new Set(), positions: new Set() });
    expect(dropped).toEqual(
      expect.arrayContaining([
        { kind: "unit", text: "Procurement" },
        { kind: "position", text: "Accountant" },
        { kind: "position", text: "Procurement Officer" },
        { kind: "specialty", text: "payroll" },
      ]),
    );
    expect(dropped).toHaveLength(4);
    const titles = rows.map((r) => r.values.titleEn ?? r.values.titleAr).filter(Boolean);
    // "Finance Manager" is written twice in the text, "Accountant" once; the Arabic one after "و".
    expect(titles.sort()).toEqual(["Accountant", "Finance Manager", "Finance Manager", "الأخصائي", "مدير الموارد البشرية"].sort());
    const c = checkOrgImport(rows, ctx(), "add");
    expect(c.rows.flatMap((r) => r.errors)).toEqual([]);
    const fm = c.plan.positions.find((p) => p.isHead && p.titleEn === "Finance Manager")!;
    expect(fm).toMatchObject({ specialties: ["budgets"] });
    expect(c.plan.positions.find((p) => p.titleEn === "Accountant")!.reportsTo).toBe(fm.code);
    expect(c.plan.units.map((u) => [u.nameEn ?? u.nameAr, u.kind])).toEqual([
      ["Finance department", "department"],
      ["الموارد البشرية", "department"],
    ]);
  });

  it("never takes a person's name from the model, even one written in the text", () => {
    const { rows } = draftRows(reply, text, { units: new Set(), positions: new Set() });
    expect(rows.filter((r) => r.values.holder || r.values.vacant)).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("Nawaf");
  });

  it("puts a position whose unit is not in the text in no unit, for a person to place", () => {
    const { rows } = draftRows({ units: [{ ref: "U9", parent: "", code: "", name: "Invented unit", kind: "unit" }], positions: [{ ref: "P1", unit: "U9", code: "", title: "Accountant", reports_to: "", head: false, specialties: [] }] }, text, {
      units: new Set(),
      positions: new Set(),
    });
    const c = checkOrgImport(rows, ctx(), "add");
    expect(c.rows.map((r) => r.errors.map((e) => e.code))).toEqual([["noUnit"]]);
  });

  it("keeps a code only when the text writes it", () => {
    const { rows } = draftRows(
      { units: [{ ref: "U1", parent: "", code: "2.4", name: "Finance", kind: "department" }, { ref: "U2", parent: "U1", code: "7", name: "Budgets", kind: "section" }], positions: [] },
      "2.4 Finance, with Budgets under it",
      { units: new Set(), positions: new Set() },
    );
    expect(rows.map((r) => [r.values.unitCode, r.values.parentCode])).toEqual([
      ["2.4", ""],
      ["2.4.1", "2.4"],
    ]);
  });
});

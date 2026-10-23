import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDocx } from "@/lib/office/docx-read";
import { readXlsx } from "@/lib/office/xlsx-read";
import {
  applyMapping,
  checkImport,
  findHeaderRow,
  hijriToIso,
  IMPORT_FIELDS,
  leaveOutDuplicates,
  MAX_IMPORT_ROWS,
  normText,
  outlineMode,
  outlineRows,
  parseDate,
  parsePriority,
  splitEvidence,
  suggestMapping,
  type ImportContext,
  type ImportRow,
} from "@/lib/plan-import";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  today: "2026-10-23",
  client: true,
  ownerByName: false,
  minimalRecords: false,
  canRelease: true,
  owners: [
    { userId: "u-abdullah", name: "Abdullah Al-Harbi", email: "abdullah@nukhba.example" },
    { userId: "u-reem", name: "Reem Al-Qahtani", email: "reem@nukhba.example" },
    { userId: "u-ar", name: "عبدالله الحربي", email: "abdullah.ar@nukhba.example" },
  ],
  departments: [{ id: "d-fin", nameAr: "الإدارة المالية", nameEn: "Finance" }],
  findings: [],
  recommendations: [],
  actions: [],
  ...over,
});
const row = (line: number, values: ImportRow["values"]): ImportRow => ({ line, include: true, values, filled: [] });
const codes = (r: { errors: { code: string }[]; warnings: { code: string }[]; notes: { code: string }[] }) => ({
  errors: r.errors.map((i) => i.code),
  warnings: r.warnings.map((i) => i.code),
  notes: r.notes.map((i) => i.code),
});

describe("column headings", () => {
  it("maps Selah's own export headings back to every field, in both languages", () => {
    for (const messages of [ar, en]) {
      const headers = [...IMPORT_FIELDS.map((f) => messages.importExport.fields[f]), messages.importExport.columns.status, messages.importExport.columns.visibility];
      expect(suggestMapping(headers)).toEqual([...IMPORT_FIELDS, null, null]);
    }
  });

  it("matches common wordings and spelling variants, one column per field", () => {
    expect(suggestMapping(["م", "الملاحظات", "التوصيات", "الاجراء", "المسؤول عن التنفيذ", "الموعد النهائي", "Notes"])).toEqual([
      null,
      "finding",
      "recommendation",
      "action",
      "owner",
      "dueDate",
      null,
    ]);
    expect(suggestMapping(["Recommendation (short title)", "Recommendation", "Owner"])).toEqual([null, "recommendation", "owner"]);
  });

  it("finds the heading row under a title row", () => {
    expect(findHeaderRow([["Board plan 2027"], [], ["Finding", "Recommendation", "Action"], ["a", "b", "c"]])).toBe(2);
    expect(findHeaderRow([[], ["x", "y"]])).toBe(1);
  });
});

describe("values", () => {
  it("reads dates in the forms people type", () => {
    const iso = (s: string) => {
      const r = parseDate(s);
      return r && "iso" in r ? r.iso : r;
    };
    expect(iso("2027-03-15")).toBe("2027-03-15");
    expect(iso("2027/3/5")).toBe("2027-03-05");
    expect(iso("15/03/2027")).toBe("2027-03-15");
    expect(iso("03/25/2027")).toBe("2027-03-25"); // month first only when it can't be day first
    expect(iso("15.03.27")).toBe("2027-03-15");
    expect(iso("٢٠٢٧/٠٤/٠١")).toBe("2027-04-01");
    expect(iso("15 March 2027")).toBe("2027-03-15");
    expect(iso("March 15, 2027")).toBe("2027-03-15");
    expect(iso("15 مارس 2027")).toBe("2027-03-15");
    expect(iso("46461")).toBe("2027-03-15");
    expect(iso("2027-03-15T00:00:00")).toBe("2027-03-15");
    expect(iso("")).toBeNull();
    for (const bad of ["2027-02-30", "2027-13-01", "next week", "2027", "15/03"]) expect(parseDate(bad)).toEqual({ error: true });
  });

  it("reads Umm al-Qura Hijri dates, marked or by their year", () => {
    expect(hijriToIso(1446, 9, 1)).toBe("2025-03-01");
    expect(hijriToIso(1448, 9, 1)).toBe("2027-02-08");
    expect(parseDate("١٥/٠٩/١٤٤٨هـ")).toEqual({ iso: "2027-02-22", hijri: true });
    expect(parseDate("1448-09-15")).toEqual({ iso: "2027-02-22", hijri: true });
    expect(parseDate("15/9/48 هـ")).toEqual({ iso: "2027-02-22", hijri: true });
    expect(parseDate("30/01/1448")).toEqual({ error: true }); // Muharram 1448 has 29 days
    expect(parseDate("31/03/1448")).toEqual({ error: true });
  });

  it("reads priorities in Arabic and English", () => {
    expect(parsePriority("عالية")).toBe("high");
    expect(parsePriority("حرجة")).toBe("critical");
    expect(parsePriority("Critical")).toBe("critical");
    expect(parsePriority("منخفضة")).toBe("low");
    expect(parsePriority("")).toBe("medium");
    expect(parsePriority("whenever")).toBeNull();
  });

  it("splits evidence lists by line or semicolon and drops bullets", () => {
    expect(splitEvidence("مسودة الميثاق\n- محضر الاعتماد؛ قرار المجلس")).toEqual(["مسودة الميثاق", "محضر الاعتماد", "قرار المجلس"]);
    expect(splitEvidence("1. Policy; 2) Minutes")).toEqual(["Policy", "Minutes"]);
  });

  it("folds Arabic spelling variants for matching", () => {
    expect(normText("الإدارة  الماليّة")).toBe(normText("الادارة الماليه"));
    expect(normText("عبـــدالله")).toBe("عبدالله");
  });
});

describe("rows from a file", () => {
  it("fills merged finding and recommendation cells from the row above, and skips blank rows", () => {
    const sheet = readXlsx(new Uint8Array(readFileSync("tests/fixtures/office/plan-ar.xlsx")))[1]!;
    const h = findHeaderRow(sheet.rows);
    const rows = applyMapping(sheet.rows, h, suggestMapping(sheet.rows[h]!));
    expect(rows.map((r) => r.line)).toEqual([3, 4, 5, 7]);
    expect(rows[1]).toMatchObject({ values: { recommendation: "اعتماد ميثاق لمجلس الإدارة", finding: "لا يوجد ميثاق لمجلس الإدارة" }, filled: ["recommendation", "finding"] });
    expect(rows[2]!.filled).toEqual(["finding"]);
    expect(rows[3]!.filled).toEqual([]);
  });

  it("reads a Word outline as findings over recommendations over actions", () => {
    const blocks = readDocx(new Uint8Array(readFileSync("tests/fixtures/office/plan-outline.docx")));
    expect(outlineMode(blocks)).toBe("findings");
    const rows = outlineRows(blocks, "findings");
    expect(rows.map((r) => r.values)).toEqual([
      {
        finding: "لا يوجد ميثاق لمجلس الإدارة",
        findingDetails: "رصد الفريق غياب ميثاق معتمد.",
        recommendation: "اعتماد ميثاق لمجلس الإدارة",
        rationale: "الميثاق يحدد صلاحيات المجلس.",
        action: "إعداد مسودة الميثاق",
      },
      { finding: "لا يوجد ميثاق لمجلس الإدارة", recommendation: "اعتماد ميثاق لمجلس الإدارة", action: "اعتماد الميثاق من المجلس", actionDetails: "خلال ثلاثة أشهر." },
      { finding: "لا يوجد ميثاق لمجلس الإدارة", recommendation: "Adopt a conflict of interest policy" },
      { finding: "Committees" },
    ]);
    // Read with every heading as a recommendation instead.
    expect(outlineRows(blocks, "recommendations").map((r) => r.values.recommendation)).toEqual([
      "لا يوجد ميثاق لمجلس الإدارة",
      "اعتماد ميثاق لمجلس الإدارة",
      "اعتماد ميثاق لمجلس الإدارة",
      "Adopt a conflict of interest policy",
      "Committees",
    ]);
  });
});

describe("checking rows", () => {
  const options = { visibility: "shared" as const, release: true };

  it("groups rows into findings, recommendations and actions, and releases only complete actions", () => {
    const check = checkImport(
      [
        row(2, { finding: "No board charter", recommendation: "Adopt a charter", priority: "High", action: "Draft it", owner: "reem@nukhba.example", dueDate: "2027-01-10", evidence: "Draft; Minutes" }),
        row(3, { finding: "No board charter", recommendation: "Adopt a charter", action: "Approve it", owner: "Reem Al-Qahtani" }),
        row(4, { recommendation: "Form a committee", action: "Name members", owner: "Reem Al-Qahtani", dueDate: "2026-01-01" }),
        row(5, { finding: "Finding only" }),
      ],
      ctx(),
      options,
    );
    expect(check.counts).toMatchObject({ findings: 2, recommendations: 2, actions: 3, released: 1, withErrors: 0 });
    expect(check.plan.actions[0]).toMatchObject({ ownerUserId: "u-reem", dueDate: "2027-01-10", evidence: ["Draft", "Minutes"], release: true });
    expect(check.plan.recommendations[0]).toMatchObject({ title: "Adopt a charter", priority: "high", findingKey: normText("No board charter") });
    expect(codes(check.rows[1]!).notes).toEqual(["staysDraft"]);
    expect(codes(check.rows[2]!)).toEqual({ errors: [], warnings: ["pastDate"], notes: ["staysDraft"] });
    expect(check.rows[3]!.creates).toEqual({ finding: true, recommendation: false, action: null });
  });

  it("keeps every action a draft unless asked, and when the person may not release", () => {
    const rows = [row(2, { recommendation: "R", action: "A", owner: "Reem Al-Qahtani", dueDate: "2027-01-10" })];
    expect(checkImport(rows, ctx(), { visibility: "shared", release: false }).counts.released).toBe(0);
    expect(checkImport(rows, ctx({ canRelease: false }), options).counts.released).toBe(0);
  });

  it("refuses rows that can't be imported as they are", () => {
    const check = checkImport(
      [
        row(2, { action: "Orphan action" }),
        row(3, { actionDetails: "details only" }),
        row(4, { recommendation: "x".repeat(301) }),
        row(5, { recommendation: "R", action: "A", dueDate: "soon" }),
        row(6, { recommendation: "R2", action: "A", evidence: Array.from({ length: 51 }, (_, i) => `item ${i}`).join("\n") }),
      ],
      ctx(),
      options,
    );
    expect(check.rows.map((r) => codes(r).errors)).toEqual([["needsRecommendation"], ["noTitle"], ["tooLong"], ["badDate"], ["tooManyItems"]]);
    expect(check.counts.withErrors).toBe(5);
    expect(check.plan.recommendations).toEqual([]);
  });

  it("matches owners by name, email or a unique partial name, and says when it can't", () => {
    const check = checkImport(
      [
        row(2, { recommendation: "R", action: "A1", owner: "ABDULLAH@nukhba.example" }),
        row(3, { recommendation: "R", action: "A2", owner: "عبـدالله" }),
        row(4, { recommendation: "R", action: "A3", owner: "Al" }),
        row(5, { recommendation: "R", action: "A4", owner: "Someone Else" }),
      ],
      ctx(),
      options,
    );
    expect(check.plan.actions.map((a) => a.ownerUserId)).toEqual(["u-abdullah", "u-ar", undefined, undefined]);
    expect(check.rows.map((r) => codes(r).warnings)).toEqual([[], ["ownerPartial"], ["ownerUnknown"], ["ownerUnknown"]]);
  });

  it("takes a typed owner for clients the firm manages", () => {
    const check = checkImport([row(2, { recommendation: "R", action: "A", owner: "CFO", dueDate: "2027-01-10" })], ctx({ ownerByName: true, owners: [] }), options);
    expect(check.plan.actions[0]).toMatchObject({ ownerName: "CFO", ownerUserId: undefined, release: true });
  });

  it("matches departments by either name, and ignores them where unused", () => {
    const rows = [row(2, { recommendation: "R", action: "A", department: "الادارة الماليه" }), row(3, { recommendation: "R", action: "B", department: "HR" })];
    const check = checkImport(rows, ctx(), options);
    expect(check.plan.actions.map((a) => a.departmentId)).toEqual(["d-fin", undefined]);
    expect(codes(check.rows[1]!).warnings).toEqual(["departmentUnknown"]);
    expect(codes(checkImport(rows, ctx({ departments: [] }), options).rows[0]!).warnings).toEqual(["departmentsOff"]);
  });

  it("reuses findings and recommendations already in the project and leaves out actions imported before", () => {
    const existing = ctx({
      findings: [{ id: "f1", title: "No board charter" }],
      recommendations: [{ id: "r1", title: "Adopt a charter", findingId: "f1" }],
      actions: [{ recommendationId: "r1", title: "Draft it" }],
    });
    const rows = [
      row(2, { finding: "no board charter", recommendation: "Adopt a Charter", action: "Draft it" }),
      row(3, { finding: "No board charter", recommendation: "Adopt a charter", action: "Approve it" }),
      row(4, { recommendation: "Adopt a charter", action: "Approve it" }),
    ];
    const check = checkImport(rows, existing, { visibility: "shared", release: false });
    expect(check.plan.findings[0]!.existingId).toBe("f1");
    expect(check.plan.recommendations[0]!.existingId).toBe("r1");
    expect(check.counts).toMatchObject({ findings: 0, recommendations: 0, actions: 3 });
    expect(codes(check.rows[0]!)).toEqual({ errors: [], warnings: ["actionExists"], notes: ["findingExists", "recommendationExists"] });
    expect(codes(check.rows[2]!).warnings).toEqual(["actionRepeated"]);
    expect(leaveOutDuplicates(rows, existing).map((r) => r.include)).toEqual([false, true, true]);
    // A row fixed on screen and imported before is still caught while the file keeps its mistake.
    const stale = [row(5, { recommendation: "Adopt a charter", action: "Draft it", dueDate: "2027-13-40" })];
    expect(leaveOutDuplicates(stale, existing).map((r) => r.include)).toEqual([false]);
  });

  it("keeps a recommendation's first details and says when later rows differ", () => {
    const check = checkImport(
      [row(2, { recommendation: "R", rationale: "First", action: "A" }), row(3, { recommendation: "R", rationale: "Second", action: "B" })],
      ctx(),
      options,
    );
    expect(check.plan.recommendations[0]!.rationale).toBe("First");
    expect(codes(check.rows[1]!).warnings).toEqual(["recommendationDiffers"]);
  });

  it("skips rows left out, and stops at the row limit", () => {
    const left = { ...row(2, { action: "no recommendation" }), include: false };
    expect(checkImport([left], ctx(), options).rows).toEqual([]);
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => row(i + 2, { recommendation: `R${i}` }));
    expect(checkImport(many, ctx(), options).tooMany).toBe(true);
  });
});

// Reading a client's indicator figures from its exports (lib/indicator-import.ts):
// CSV, periods and numbers as real exports write them, the three table
// shapes, matching to the client's own indicators, and what a batch does.
import { describe, expect, it } from "vitest";
import {
  detectShape,
  matchIndicator,
  matchLabels,
  parseNumber,
  parsePeriod,
  planCounts,
  planValues,
  readCsv,
  readValues,
  sheetCsvUrl,
  sheetHostAllowed,
  type IndicatorRef,
} from "@/lib/indicator-import";
import { INDICATOR_TEMPLATES, TEMPLATE_AREAS } from "@/lib/indicator-templates";

const K: IndicatorRef[] = [
  { id: "k1", nameAr: "شكاوى العملاء", nameEn: "Customer complaints", code: "complaints", frequency: "monthly", baselinePeriod: "2026-01-01", active: true, feedOn: true },
  { id: "k2", nameAr: "معدل دوران الموظفين", nameEn: "Staff turnover", code: null, frequency: "quarterly", baselinePeriod: "2026-01-01", active: true },
  { id: "k3", nameAr: null, nameEn: "Old measure", code: null, frequency: "monthly", baselinePeriod: "2026-01-01", active: false },
];

describe("CSV", () => {
  it("drops the byte-order mark, guesses the delimiter and honours quotes", () => {
    expect(readCsv('﻿a,b\n"1,5","say ""hi"""\r\n\n')).toEqual([
      ["a", "b"],
      ["1,5", 'say "hi"'],
    ]);
    expect(readCsv("الشهر;القيمة\n2026-02;38")).toEqual([
      ["الشهر", "القيمة"],
      ["2026-02", "38"],
    ]);
    expect(readCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("periods", () => {
  it.each([
    ["2026-03-15", "2026-03-01"],
    ["2026-03", "2026-03-01"],
    ["2026/3", "2026-03-01"],
    ["15/03/2026", "2026-03-01"],
    ["03/2026", "2026-03-01"],
    ["202603", "2026-03-01"],
    ["Mar 2026", "2026-03-01"],
    ["March-26", "2026-03-01"],
    ["2026 March", "2026-03-01"],
    ["مارس 2026", "2026-03-01"],
    ["مارس ٢٠٢٦", "2026-03-01"],
    ["آذار 2026", "2026-03-01"],
    ["تشرين الأول 2026", "2026-10-01"],
    ["Q2 2026", "2026-04-01"],
    ["2026-Q3", "2026-07-01"],
    ["الربع الرابع 2026", "2026-10-01"],
  ])("%s", (raw, want) => expect(parsePeriod(raw)).toBe(want));

  it("is null for what is not a period", () => {
    for (const raw of ["", "Total", "2026-13", "Revenue", "12345", "Q5 2026"]) expect(parsePeriod(raw), raw).toBeNull();
  });
});

describe("numbers", () => {
  it.each([
    ["1,234.5", 1234.5],
    ["١٬٢٣٤٫٥", 1234.5],
    ["(1,200)", -1200],
    ["12.5%", 12.5],
    ["SAR 9 500", 9500],
    ["9,500 ر.س", 9500],
    ["12,5", 12.5],
    ["-3", -3],
  ])("%s", (raw, want) => expect(parseNumber(raw)).toBe(want));

  it("an empty cell or a dash is no value; words are not a number", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("—")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
    expect(parseNumber("about ten")).toBeNaN();
  });
});

describe("table shapes", () => {
  it("rows: one row per indicator, months across (a management report)", () => {
    const rows = [
      ["Management report 2026"],
      ["KPI", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["Customer complaints", "40", "38", ""],
      ["Staff turnover", "", "", "17"],
    ];
    const shape = detectShape(rows);
    expect([shape.layout, shape.headerRow, shape.labelCol]).toEqual(["rows", 1, 0]);
    expect(readValues(rows, shape).map((v) => [v.label, v.period, v.value])).toEqual([
      ["Customer complaints", "2026-01-01", 40],
      ["Customer complaints", "2026-02-01", 38],
      ["Staff turnover", "2026-03-01", 17],
    ]);
  });

  it("columns: one row per month, indicators across (a system export, a shared sheet)", () => {
    const rows = [
      ["Month", "complaints", "معدل دوران الموظفين"],
      ["2026-02", "38", ""],
      ["2026-04", "35", "17"],
    ];
    const shape = detectShape(rows);
    expect([shape.layout, shape.periodCol]).toEqual(["columns", 0]);
    expect(readValues(rows, shape).map((v) => [v.label, v.period, v.value])).toEqual([
      ["complaints", "2026-02-01", 38],
      ["complaints", "2026-04-01", 35],
      ["معدل دوران الموظفين", "2026-04-01", 17],
    ]);
  });

  it("list: one row per figure, with a note", () => {
    const rows = [
      ["المؤشر", "الفترة", "القيمة", "ملاحظات"],
      ["complaints", "فبراير 2026", "38", "after the new desk"],
    ];
    const shape = detectShape(rows);
    expect(shape).toMatchObject({ layout: "list", labelCol: 0, periodCol: 1, valueCol: 2, noteCol: 3 });
    expect(readValues(rows, shape)[0]).toMatchObject({ label: "complaints", period: "2026-02-01", value: 38, note: "after the new desk" });
  });
});

describe("matching each client's own indicators", () => {
  it("by code, else by a name in either language with spelling folded; never a guess between two", () => {
    expect(matchIndicator("COMPLAINTS", K)).toBe("k1");
    expect(matchIndicator("شكاوي العملاء", K)).toBe("k1");
    expect(matchIndicator("staff  turnover", K)).toBe("k2");
    expect(matchIndicator("Revenue", K)).toBeNull();
    expect(matchIndicator("x", [...K, { ...K[0]!, id: "dup", code: null }].map((k) => ({ ...k, nameEn: "x" })))).toBeNull();
    expect(matchLabels(["Revenue", "complaints"], K, { Revenue: "k2" })).toEqual({ Revenue: "k2", complaints: "k1" });
  });
});

describe("what a batch does", () => {
  const map = { a: "k1", b: "k2", c: "k3", z: null };
  const v = (label: string, period: string | null, value: number | null, line = 1) => ({ line, label, period, value, note: null });
  const current = new Map([["k1|2026-02-01", { id: "v1", value: 38 }]]);

  it("adds, corrects, leaves the same, and says why the rest can't count", () => {
    const plan = planValues(
      [
        v("a", "2026-03-01", 36),
        v("a", "2026-02-01", 37),
        v("a", "2026-02-01", 37),
        v("z", "2026-03-01", 1),
        v("a", null, 1),
        v("a", "2026-01-01", 40),
        v("b", "2026-02-01", 17),
        v("b", "2026-04-01", Number.NaN),
        v("a", "2099-01-01", 1),
        v("c", "2026-03-01", 1),
      ],
      map,
      K,
      current,
      { today: "2026-10-30", corrections: true },
    );
    expect(plan.map((p) => p.status ?? p.issue)).toEqual(["add", "correct", "duplicate", "unmatched", "no_period", "baseline", "not_a_period", "bad_value", "future", "inactive"]);
    expect(plan[1]!.current).toEqual({ id: "v1", value: 38 });
    expect(planCounts(plan)).toEqual({ add: 1, correct: 1, same: 0, left: 8 });
  });

  it("keeps a period's figure when corrections are off, and says nothing changes when it is the same", () => {
    const plan = planValues([v("a", "2026-02-01", 37), v("a", "2026-02-01", 38, 2)], { a: "k1" }, K, current, { today: "2026-10-30", corrections: false });
    expect(plan.map((p) => p.status ?? p.issue)).toEqual(["keep", "duplicate"]);
    const same = planValues([v("a", "2026-02-01", 38)], { a: "k1" }, K, current, { today: "2026-10-30", corrections: false });
    expect(same[0]!.status).toBe("same");
  });

  it("from a connection, only indicators the client lets it fill", () => {
    const plan = planValues([v("a", "2026-03-01", 1), v("b", "2026-04-01", 1)], map, K, new Map(), { today: "2026-10-30", corrections: true, connection: true });
    expect(plan.map((p) => p.status ?? p.issue)).toEqual(["add", "not_connected"]);
  });
});

describe("sheet links", () => {
  it("turns a Google Sheets link into its CSV, and refuses anything else", () => {
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-1vT/pubhtml?gid=12&single=true")).toBe(
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vT/pub?output=csv&gid=12",
    );
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=7")).toBe(
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/export?format=csv&gid=7",
    );
    for (const bad of [
      "http://docs.google.com/spreadsheets/d/e/x/pub",
      "https://evil.example/x.csv",
      "https://169.254.169.254/latest",
      "https://user:pw@docs.google.com/spreadsheets/d/e/x/pub",
      "https://docs.google.com:8443/spreadsheets/d/e/x/pub",
      "not a link",
    ])
      expect(sheetCsvUrl(bad), bad).toBeNull();
    expect(sheetCsvUrl("https://reports.client.example/kpis.csv", ["reports.client.example"])).toBe("https://reports.client.example/kpis.csv");
  });

  it("follows redirects only to Google's own hosts or the firm's list", () => {
    expect(sheetHostAllowed("doc-0s-8c-sheets.googleusercontent.com")).toBe(true);
    expect(sheetHostAllowed("localhost")).toBe(false);
    expect(sheetHostAllowed("googleusercontent.com.evil.example")).toBe(false);
  });
});

describe("starter indicators", () => {
  it("each has both names, a unit, an area, and a key fit to be a code", () => {
    const keys = new Set<string>();
    for (const t of INDICATOR_TEMPLATES) {
      expect(t.nameAr && t.nameEn && t.unit && t.definitionAr && t.definitionEn, t.key).toBeTruthy();
      expect(TEMPLATE_AREAS).toContain(t.area);
      expect(t.key).toMatch(/^[a-z0-9][a-z0-9_.-]{0,39}$/);
      expect(keys.has(t.key)).toBe(false);
      keys.add(t.key);
    }
    for (const area of TEMPLATE_AREAS) expect(INDICATOR_TEMPLATES.some((t) => t.area === area)).toBe(true);
  });
});

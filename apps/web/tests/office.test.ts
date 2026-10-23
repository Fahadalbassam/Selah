import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readDocx } from "@/lib/office/docx-read";
import { isDateFormat, readXlsx, serialToIso } from "@/lib/office/xlsx-read";
import { writeXlsx } from "@/lib/office/xlsx-write";
import { OfficeFileError, readEntries } from "@/lib/office/zip";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/office/${name}`));
const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof OfficeFileError ? err.reason : String(err);
  }
  return "no error";
};

describe("reading .xlsx", () => {
  it("reads the visible sheets of a workbook made by openpyxl, with Arabic text and real dates", () => {
    const sheets = readXlsx(fixture("plan-ar.xlsx"));
    expect(sheets.map((s) => s.name)).toEqual(["تعليمات", "الخطة"]); // the hidden sheet is left out
    const plan = sheets[1]!;
    expect(plan.rows[1]).toEqual(["الملاحظة", "التوصية", "الأولوية", "الإجراء", "المسؤول", "تاريخ الاستحقاق", "قائمة الأدلة", "الحالة"]);
    expect(plan.rows[2]![5]).toBe("2027-03-15");
    expect(plan.rows[2]![6]).toBe("مسودة الميثاق\nمحضر الاعتماد");
    expect(plan.rows[3]![5]).toBe("١٥/٠٩/١٤٤٨هـ");
    // Merged cells keep their value in the first cell only.
    expect(plan.rows[3]![0]).toBe("");
    expect(plan.rows[5]).toEqual([]);
  });

  it("knows date formats and Excel day numbers", () => {
    expect(isDateFormat("yyyy-mm-dd")).toBe(true);
    expect(isDateFormat('[$-ar-SA]dd/mm/yyyy')).toBe(true);
    expect(isDateFormat("h:mm")).toBe(false);
    expect(isDateFormat("0.00%")).toBe(false);
    expect(serialToIso(46461)).toBe("2027-03-15");
    expect(serialToIso(45000, true)).toBe("2027-03-16");
    expect(serialToIso(-3)).toBeNull();
  });

  it("refuses a file that is not a zip, and one with a document type declaration", () => {
    expect(reason(() => readXlsx(strToU8("not a workbook")))).toBe("not_office");
    const doctype = zipSync({ "xl/workbook.xml": strToU8('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><workbook/>') });
    expect(reason(() => readXlsx(doctype))).toBe("unsafe");
  });

  it("refuses zip bombs before inflating them", () => {
    const huge = zipSync({ "xl/workbook.xml": new Uint8Array(41 * 1024 * 1024) });
    expect(huge.byteLength).toBeLessThan(200_000);
    expect(reason(() => readXlsx(huge))).toBe("too_large");
    const dense = zipSync({ "xl/workbook.xml": new Uint8Array(3 * 1024 * 1024) });
    expect(reason(() => readXlsx(dense))).toBe("unsafe");
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 2001; i++) many[`f${i}.xml`] = strToU8("x");
    expect(reason(() => readEntries(zipSync(many), () => false))).toBe("too_large");
  });
});

describe("writing .xlsx", () => {
  it("round-trips text, Arabic, line breaks and dates, and never writes formulas", () => {
    const bytes = writeXlsx([
      {
        name: "الخطة: أ/ب",
        rtl: true,
        columns: [{ header: "التوصية" }, { header: "Due" }, { header: "Count" }],
        rows: [
          ["اعتماد الميثاق", { date: "2027-03-15" }, 3],
          ['=HYPERLINK("http://evil.example","x")', null, null],
          ["line one\nline two", { date: "not a date" }, Number.NaN],
        ],
      },
    ]);
    const files = readEntries(bytes, () => true);
    expect(files.get("xl/workbook.xml")).toContain('name="الخطة  أ ب"');
    expect(files.get("xl/worksheets/sheet1.xml")).toContain('rightToLeft="1"');
    expect(files.get("xl/worksheets/sheet1.xml")).not.toContain("<f>");
    const [sheet] = readXlsx(bytes);
    expect(sheet!.rows).toEqual([
      ["التوصية", "Due", "Count"],
      ["اعتماد الميثاق", "2027-03-15", "3"],
      ['=HYPERLINK("http://evil.example","x")'],
      ["line one\nline two"],
    ]);
  });
});

describe("reading .docx", () => {
  it("reads headings, list items, paragraphs and tables from a document made by python-docx", () => {
    const blocks = readDocx(fixture("plan-outline.docx"));
    expect(blocks.filter((b) => b.type === "heading")).toEqual([
      { type: "heading", level: 1, text: "1. لا يوجد ميثاق لمجلس الإدارة" },
      { type: "heading", level: 2, text: "1.1 اعتماد ميثاق لمجلس الإدارة" },
      { type: "heading", level: 2, text: "1.2 Adopt a conflict of interest policy" },
      { type: "heading", level: 1, text: "2. Committees" },
    ]);
    expect(blocks).toContainEqual({ type: "paragraph", text: "إعداد مسودة الميثاق", list: true });
    expect(blocks).toContainEqual({ type: "paragraph", text: "خلال ثلاثة أشهر.", list: false });
    // The title (style "Title") is not a heading of the plan.
    expect(blocks.some((b) => b.type !== "table" && b.text === "تقرير الحوكمة")).toBe(false);
    const table = blocks.find((b) => b.type === "table");
    expect(table).toEqual({
      type: "table",
      rows: [
        ["Recommendation", "Action", "Owner", "Due date"],
        ["Form an audit committee", "Name the members", "Reem", "2027-05-01"],
        ["", "Approve the committee charter", "Reem", "01/06/2027"],
      ],
    });
  });

  it("leaves out tracked deletions and reads content controls, merged cells and numbered paragraphs", () => {
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<?xml version="1.0"?><w:document ${w}><w:body>
      <w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Gap</w:t></w:r></w:p>
      <w:sdt><w:sdtContent><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
        <w:r><w:t xml:space="preserve">Keep </w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins><w:r><w:t>this</w:t></w:r></w:ins></w:p></w:sdtContent></w:sdt>
      <w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Wide</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>A &amp; B &#1575;</w:t></w:r></w:p>
    </w:body></w:document>`;
    const blocks = readDocx(zipSync({ "word/document.xml": strToU8(doc) }));
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Gap" },
      { type: "paragraph", text: "Keep this", list: true },
      { type: "table", rows: [["Wide", "", "C"]] },
      { type: "paragraph", text: "A & B ا", list: false },
    ]);
  });
});

import { execFileSync } from "node:child_process";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { cleanPdfText, extractText, pdfPages, runPdftotext } from "@/jobs/extract-text";
import { readDocxPages } from "@/lib/office/docx-read";
import { readPptxSlides } from "@/lib/office/pptx-read";
import { writeXlsx } from "@/lib/office/xlsx-write";

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;
const docx = (body: string) => zip({ "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>` });
const p = (...runs: string[]) => `<w:p>${runs.map((r) => (r.startsWith("<") ? r : `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`)).join("")}</w:p>`;

/** A small PDF with one text page and one page with no text layer (as a scan has). */
function pdf(text: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
    null, // the content stream, below
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 760 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("Word files by page", () => {
  it("splits at the page marks Word saved, and reads Arabic, tables and tracked insertions", () => {
    const pages = readDocxPages(
      docx(
        p("ميثاق مجلس الإدارة") +
          p("The board meets quarterly.") +
          `<w:tbl><w:tr><w:tc>${p("Role")}</w:tc><w:tc>${p("Chair")}</w:tc></w:tr></w:tbl>` +
          p("<w:r><w:lastRenderedPageBreak/><w:t>Second page</w:t></w:r>") +
          p(`<w:ins><w:r><w:t>added</w:t></w:r></w:ins>`, `<w:del><w:r><w:delText>removed</w:delText></w:r></w:del>`),
      ),
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("ميثاق مجلس الإدارة");
    expect(pages[0]).toContain("Role\tChair");
    expect(pages[1]).toContain("Second page");
    expect(pages[1]).toContain("added");
    expect(pages.join(" ")).not.toContain("removed");
  });

  it("falls back to explicit page breaks when Word saved no page marks", () => {
    const pages = readDocxPages(docx(p("one") + p(`<w:r><w:br w:type="page"/></w:r>`, "two") + `<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>three</w:t></w:r></w:p>`));
    expect(pages).toEqual(["one", "two", "three"]);
  });
});

describe("PowerPoint files by slide", () => {
  it("follows the order the presentation shows, not the file names", () => {
    const slide = (t: string) =>
      `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const bytes = zip({
      "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`,
      "ppt/slides/slide1.xml": slide("الخطوات التالية"),
      "ppt/slides/slide2.xml": slide("Agenda"),
    });
    expect(readPptxSlides(bytes)).toEqual(["Agenda", "الخطوات التالية"]);
  });
});

describe("Excel files by sheet", () => {
  it("makes each sheet a page that starts with its name", async () => {
    const bytes = writeXlsx([
      { name: "الخطة", rtl: true, columns: [{ header: "التوصية" }, { header: "Owner" }], rows: [["اعتماد الميثاق", "Reem"]] },
      { name: "KPIs", rtl: false, columns: [{ header: "KPI" }], rows: [["Board attendance"]] },
    ]);
    const { pages, scanned } = await extractText("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes);
    expect(pages.map((p) => p.n)).toEqual([1, 2]);
    expect(pages[0]!.text).toContain("اعتماد الميثاق\tReem");
    expect(pages[1]!.text.startsWith("KPIs")).toBe(true);
    expect(scanned).toEqual([]);
  });
});

describe("PDF files", () => {
  it("flags pages without a text layer as scanned, and folds Arabic presentation forms", () => {
    const out = pdfPages("ﻣﺮﺣﺒﺎ ﺑﻜﻢ في تقرير الحوكمة السنوي للمجلس\f\f   12  \f");
    expect(out.pages.map((p) => p.n)).toEqual([1, 2, 3]);
    expect(out.pages[0]!.text).toContain("مرحبا بكم");
    expect(out.scanned).toEqual([2, 3]);
    expect(out.pages[1]!.text).toBe("");
  });

  it("puts right the article before a reversed lam-alef, and drops direction marks", () => {
    expect(cleanPdfText("\u202bمجلس اإلدارة واألعمال\u202c")).toBe("مجلس الإدارة والأعمال");
    expect(cleanPdfText("إلى الإدارة")).toBe("إلى الإدارة");
  });

  it("a picture is a scan", async () => {
    expect(await extractText("image/png", new Uint8Array([1]))).toEqual({ pages: [], scanned: [1] });
  });

  it.runIf(hasPdftotext)("reads a real PDF with pdftotext, page by page", async () => {
    const { pages, scanned } = await extractText("application/pdf", pdf("Board governance report for the annual meeting"));
    expect(pages[0]!.text).toContain("Board governance report");
    expect(scanned).toEqual([2]);
  });

  it.runIf(hasPdftotext)("refuses a file that isn't a PDF", async () => {
    await expect(runPdftotext(strToU8("not a pdf at all"))).rejects.toThrow(/pdftotext failed/);
  });
});

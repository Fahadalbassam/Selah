import { describe, expect, it } from "vitest";
import { checkUpload, cleanFileName, MAX_UPLOAD_BYTES } from "@/lib/upload-rules";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);

describe("upload rules", () => {
  it("accepts a real PDF", () => {
    expect(checkUpload("الميثاق.pdf", "application/pdf", 100, pdf)).toEqual({
      ok: true,
      contentType: "application/pdf",
      fileName: "الميثاق.pdf",
    });
  });

  it("rejects a file whose bytes do not match its extension", () => {
    expect(checkUpload("charter.pdf", "application/pdf", 100, png)).toEqual({ ok: false, reason: "type" });
  });

  it("rejects a declared type that disagrees with the extension", () => {
    expect(checkUpload("charter.pdf", "text/html", 100, pdf)).toEqual({ ok: false, reason: "type" });
  });

  it("rejects executables, HTML and files with no extension", () => {
    for (const name of ["setup.exe", "page.html", "image.svg", "README"]) {
      expect(checkUpload(name, "", 100, pdf).ok, name).toBe(false);
    }
  });

  it("rejects empty and oversized files", () => {
    expect(checkUpload("a.pdf", "application/pdf", 0, pdf)).toEqual({ ok: false, reason: "empty" });
    expect(checkUpload("a.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1, pdf)).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects binary content posing as text", () => {
    expect(checkUpload("notes.txt", "text/plain", 10, new Uint8Array([0x68, 0x00, 0x69])).ok).toBe(false);
  });

  it("rejects legacy Office formats that carry macros", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    expect(checkUpload("budget.xls", "application/vnd.ms-excel", 100, ole).ok).toBe(false);
    expect(checkUpload("memo.doc", "application/msword", 100, ole).ok).toBe(false);
  });

  it("removes bidirectional overrides that disguise the real extension", () => {
    expect(cleanFileName("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(checkUpload("report\u202Eexe.pdf", "application/pdf", 100, pdf)).toMatchObject({ ok: true, fileName: "reportexe.pdf" });
  });

  it("strips paths and characters that break headers", () => {
    expect(cleanFileName('..\\..\\evil"name<>.pdf')).toBe("evilname.pdf");
    expect(cleanFileName("/etc/passwd")).toBe("passwd");
    expect(cleanFileName("   ")).toBe("file");
  });
});

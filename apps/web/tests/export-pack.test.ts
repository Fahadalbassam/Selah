import { describe, expect, it } from "vitest";
import { packPath, safeSegment } from "@/lib/offboarding";

// Where a client's files land in its export pack (J14.2): names any system can
// unpack, Arabic kept, and no two files on the same path.
describe("export pack paths", () => {
  const pdf = "application/pdf";

  it("keeps Arabic and drops what a file system refuses", () => {
    expect(safeSegment("ميثاق مجلس الإدارة", "x")).toBe("ميثاق مجلس الإدارة");
    expect(safeSegment('a/b\\c:d*e?"f<g>h|i', "x")).toBe("a b c d e f g h i");
    expect(safeSegment("  ..hidden.. ", "x")).toBe("hidden");
    expect(safeSegment("../../etc/passwd", "x")).toBe("etc passwd");
    expect(safeSegment("   ", "fallback")).toBe("fallback");
    expect(safeSegment("x".repeat(200), "f")).toHaveLength(80);
  });

  it("puts each file under its project, with its version and type", () => {
    const used = new Set<string>();
    expect(packPath(used, { project: "Governance", title: "Charter.pdf", version: 1, contentType: pdf })).toBe("files/Governance/Charter.pdf");
    expect(packPath(used, { project: "Governance", title: "Charter", version: 3, contentType: pdf })).toBe("files/Governance/Charter (v3).pdf");
    expect(packPath(used, { project: "Governance", title: "Data", version: 1, contentType: "application/x-unknown" })).toBe("files/Governance/Data.bin");
  });

  it("never lets two files share a path, whatever the case", () => {
    const used = new Set<string>();
    const a = packPath(used, { project: "P", title: "Report", version: 1, contentType: pdf });
    const b = packPath(used, { project: "P", title: "report", version: 1, contentType: pdf });
    const c = packPath(used, { project: "p", title: "REPORT", version: 1, contentType: pdf });
    expect(new Set([a, b, c].map((x) => x.toLowerCase())).size).toBe(3);
    expect(b).toBe("files/P/report 2.pdf");
  });

  it("never climbs out of files/", () => {
    const used = new Set<string>();
    const p = packPath(used, { project: "../..", title: "../../evil", version: 1, contentType: pdf });
    expect(p.startsWith("files/")).toBe(true);
    expect(p.split("/").some((seg) => seg === ".." || seg === ".")).toBe(false);
  });
});

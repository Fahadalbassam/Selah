// The words around a deliverable handed over (F21). The closure report and
// the export pack are read by both sides, so their deliverable lines never
// talk about "the client" (review S4); and "received" is receipt only, never
// acceptance, in both languages.
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const messages = { ar, en } as const;
const strings = (o: unknown): string[] => (typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : []);

describe("deliverable words read by both sides", () => {
  for (const locale of ["ar", "en"] as const) {
    const m = messages[locale];
    const both = [
      ...strings(m.deliverables.text),
      ...strings(m.deliverables.status),
      m.closurePdf.deliverablesTitle,
      m.closurePdf.deliverablesNote,
      m.closurePdf.colDeliverable,
      m.closurePdf.colFiles,
      m.closurePdf.colReceipt,
      ...strings(m.offboarding.pack.csv),
    ];

    it(`${locale}: the closure report and the export pack never name "the client"`, () => {
      expect(both.filter((s) => (locale === "ar" ? /العميل|للعميل/ : /\bclient\b/i).test(s))).toEqual([]);
    });

    it(`${locale}: the closure report's section is headed "Handed over" and says receipt is never acceptance`, () => {
      expect(m.closurePdf.deliverablesTitle).toBe(locale === "ar" ? "ما سُلِّم" : "Handed over");
      expect(m.closurePdf.deliverablesNote).toMatch(locale === "ar" ? /لا يعني أبدًا قبول العمل/ : /never means the work was accepted/);
    });
  }
});

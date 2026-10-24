// The information request choices are the database's enums, and the
// template list is well formed in both languages.
import { describe, expect, it } from "vitest";
import { infoRequestArea, infoRequestSensitivity, infoRequestStatus } from "@/db/schema";
import {
  INFO_REQUEST_AREAS,
  INFO_REQUEST_SENSITIVITIES,
  INFO_REQUEST_STATUSES,
  INFO_REQUEST_TEMPLATES,
  infoRequestEdit,
  infoRequestInput,
  NO_OWNER,
  requestTitle,
} from "@/lib/info-requests";

describe("information requests", () => {
  it("match the database enums", () => {
    expect([...INFO_REQUEST_AREAS]).toEqual(infoRequestArea.enumValues);
    expect([...INFO_REQUEST_STATUSES]).toEqual(infoRequestStatus.enumValues);
    expect([...INFO_REQUEST_SENSITIVITIES]).toEqual(infoRequestSensitivity.enumValues);
  });

  it("have unique template keys under their own area, with titles the database accepts", () => {
    const keys = INFO_REQUEST_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of INFO_REQUEST_TEMPLATES) {
      expect(t.key.startsWith(`${t.area}.`), t.key).toBe(true);
      for (const title of [t.en, t.ar]) {
        expect(title.length, t.key).toBeGreaterThanOrEqual(2);
        expect(title.length, t.key).toBeLessThanOrEqual(200);
      }
    }
    for (const area of INFO_REQUEST_AREAS.filter((a) => a !== "other")) {
      expect(INFO_REQUEST_TEMPLATES.some((t) => t.area === area), area).toBe(true);
    }
  });

  it("show a template item in the reader's language, and the firm's own wording otherwise", () => {
    expect(requestTitle({ templateKey: "legal.cr", title: "x" }, true)).toBe("شهادة السجل التجاري السارية");
    expect(requestTitle({ templateKey: "legal.cr", title: "x" }, false)).toBe("Commercial registration certificate (current)");
    expect(requestTitle({ templateKey: null, title: "Our own" }, true)).toBe("Our own");
  });
});

describe("editing an item", () => {
  it("keeps what an edit leaves out, and reads 'none' as no owner", () => {
    expect(infoRequestEdit.parse({ title: "Board minutes" })).toEqual({ title: "Board minutes" });
    expect(infoRequestEdit.parse({ ownerUserId: NO_OWNER })).toEqual({ ownerUserId: null });
    expect(infoRequestInput.parse({ area: "legal", title: "CR" }).sensitivity).toBe("standard");
  });
});

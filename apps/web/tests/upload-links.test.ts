import { describe, expect, it } from "vitest";
import { renderMail } from "@/lib/mail-templates";
import { isUploadLinkToken, UPLOAD_LINK_DAY_CHOICES, UPLOAD_LINK_DAYS, uploadLinkInput } from "@/lib/upload-links";

// Upload links for one request item (wave 2, F14 part 2): the form's input,
// the token shape the public page accepts, and the mail.
describe("upload links", () => {
  it("takes an address and 1 to 30 days, 7 unless chosen", () => {
    expect(uploadLinkInput.parse({ email: "a@b.sa" })).toEqual({ email: "a@b.sa", days: UPLOAD_LINK_DAYS.default });
    expect(uploadLinkInput.parse({ email: "a@b.sa", days: "14" })).toEqual({ email: "a@b.sa", days: 14 });
    expect(uploadLinkInput.safeParse({ email: "a@b.sa", days: 31 }).success).toBe(false);
    expect(uploadLinkInput.safeParse({ email: "a@b.sa", days: 0 }).success).toBe(false);
    expect(uploadLinkInput.safeParse({ email: "not an address" }).success).toBe(false);
    expect(uploadLinkInput.safeParse({ email: "a@b.sa", requestId: "x" }).success).toBe(false);
    for (const d of UPLOAD_LINK_DAY_CHOICES) expect(d >= UPLOAD_LINK_DAYS.min && d <= UPLOAD_LINK_DAYS.max).toBe(true);
  });

  it("accepts only 43-character base64url tokens", () => {
    expect(isUploadLinkToken("a".repeat(43))).toBe(true);
    expect(isUploadLinkToken("a-b_C".padEnd(43, "0"))).toBe(true);
    expect(isUploadLinkToken("a".repeat(42))).toBe(false);
    expect(isUploadLinkToken("../".padEnd(43, "a"))).toBe(false);
  });

  it("mails the link and a line in both languages, never the item", () => {
    const m = renderMail("info_request.upload_link", `/upload/${"a".repeat(43)}`, "http://selah.test");
    expect(m.subject).toContain(" | ");
    expect(m.text).toContain(`http://selah.test/upload/${"a".repeat(43)}`);
    expect(m.html).toContain('dir="rtl"');
  });
});

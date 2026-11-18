// The inquiry form's privacy notice (page audit row 51, batch 1) is one more
// document of the legal set, at /legal/inquiry-privacy, in the same layout.
// The old address, /privacy, sends people there for good, and nothing in the
// app links to the old address any more.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import config from "../next.config";
import { LEGAL_DOCS, LEGAL_SLUGS, legalDocFromSlug, legalVersion, splitPageAddresses } from "@/lib/legal";
import { PRIVACY_NOTICE_VERSION } from "@/lib/intake";

describe("the old address", () => {
  it("redirects permanently to the notice in the legal set, before any page is drawn", async () => {
    const redirects = (await config.redirects?.()) ?? [];
    expect(redirects).toContainEqual({ source: "/privacy", destination: "/legal/inquiry-privacy", permanent: true });
    // No page of its own is left to draw it differently.
    expect(existsSync("src/app/(public)/privacy")).toBe(false);
  });
});

describe("the inquiry privacy notice in the legal set", () => {
  it("is a document of the set, with its own address and the version the form sends", () => {
    expect(LEGAL_DOCS).toContain("inquiry_privacy");
    expect(LEGAL_SLUGS.inquiry_privacy).toBe("inquiry-privacy");
    expect(legalDocFromSlug("inquiry-privacy")).toBe("inquiry_privacy");
    expect(legalVersion("inquiry_privacy")).toBe(PRIVACY_NOTICE_VERSION);
  });

  it("has a title, an introduction and its six sections in both languages", () => {
    for (const m of [ar, en]) {
      const doc = m.legal.inquiry_privacy;
      expect(doc.title).toBeTruthy();
      expect(doc.intro).toBeTruthy();
      expect(doc.sections).toHaveLength(6);
      for (const s of doc.sections) expect(s.title && s.body).toBeTruthy();
    }
  });
});

describe("links", () => {
  /** Every source file. */
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  }
  /** Every string of a catalogue with its key. */
  function strings(o: object, path = "", out: [string, string][] = []): [string, string][] {
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === "string") out.push([p, v]);
      else if (v && typeof v === "object") strings(v as object, p, out);
    }
    return out;
  }

  it("in the code never point at the old address", () => {
    const hits = files("src").filter((f) => /["'`]\/privacy["'`?#]/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("in the texts take a reader of the old address to the new one", () => {
    for (const m of [ar, en]) {
      for (const [key, s] of strings(m)) {
        // Outside the legal texts no text names it; inside, it is shown as written and links to the new place.
        if (!key.startsWith("legal.")) expect(s, key).not.toMatch(/(?<![\w/-])\/privacy(?![\w/-])/);
        for (const part of splitPageAddresses(s)) if (part.href) expect(part.href, key).not.toBe("/privacy");
      }
    }
  });
});

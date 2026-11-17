// What a signed-out visitor's browser is sent. Client components get their
// strings from the page's HTML, so a layout that hands over the whole
// catalogue puts the firm's internal wording in the source of the sign-in
// page (it was 265 KB that way). These tests fail if a signed-out layout
// passes the whole catalogue again, or a namespace it has no use for.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { pickNamespaces, SIGNED_OUT_NAMESPACES, signedOutMessages, type SignedOutArea } from "@/i18n/signed-out-messages";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const APP = "src/app";

/** What each signed-out area may send, and nothing more. Widen this only for a string its own pages show. */
const ALLOWED: Record<SignedOutArea, string[]> = {
  auth: ["signIn", "account", "security", "consent", "common"],
  inquiry: ["inquiry"],
  legal: [],
  privacy: [],
  upload: ["uploadLink", "fileActions", "common"],
};

/** Namespaces written for visitors and for every account alike. Everything else in the catalogue is the app's own. */
const PUBLIC_SAFE = new Set(["app", "signIn", "notFound", "account", "security", "consent", "common", "inquiry", "privacy", "legal", "uploadLink", "fileActions"]);

/** The file that hands each area its strings. */
const PROVIDERS: Record<SignedOutArea, string> = {
  auth: `${APP}/(auth)/layout.tsx`,
  inquiry: `${APP}/(public)/inquiry/layout.tsx`,
  legal: `${APP}/(public)/legal/layout.tsx`,
  privacy: `${APP}/(public)/privacy/layout.tsx`,
  upload: `${APP}/(public)/upload/[token]/page.tsx`,
};

/** The folder whose client components read from that provider. */
const FOLDERS: Record<SignedOutArea, string> = {
  auth: `${APP}/(auth)`,
  inquiry: `${APP}/(public)/inquiry`,
  legal: `${APP}/(public)/legal`,
  privacy: `${APP}/(public)/privacy`,
  upload: `${APP}/(public)/upload`,
};

const AREAS = Object.keys(SIGNED_OUT_NAMESPACES) as SignedOutArea[];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("what signed-out pages send to the browser", () => {
  it("is a short list of namespaces per area, each on the allow-list", () => {
    expect(AREAS.sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const area of AREAS) expect([...SIGNED_OUT_NAMESPACES[area]].sort(), area).toEqual([...ALLOWED[area]].sort());
  });

  it("never includes a namespace written for the firm's or a client's own screens", () => {
    const firmOnly = Object.keys(ar).filter((ns) => !PUBLIC_SAFE.has(ns));
    // The catalogue's internal wording, by name: the audit found these in the sign-in page's source.
    for (const ns of ["staffing", "conflicts", "qualification", "audit", "engagement", "oversight", "settings", "clients"]) {
      expect(firmOnly, ns).toContain(ns);
    }
    for (const area of AREAS) {
      for (const messages of [ar, en]) {
        const sent = signedOutMessages(messages, area);
        expect(Object.keys(sent).filter((ns) => firmOnly.includes(ns)), area).toEqual([]);
        expect(Object.keys(sent).sort(), area).toEqual([...ALLOWED[area]].sort());
      }
    }
  });

  it("is a small part of the catalogue, not all of it", () => {
    const whole = JSON.stringify(ar).length;
    for (const area of AREAS) {
      const sent = JSON.stringify(signedOutMessages(ar, area)).length;
      expect(sent, area).toBeLessThan(whole / 10);
    }
    // The firm's wording the audit read in the sign-in page's source.
    const signIn = JSON.stringify(signedOutMessages(en, "auth"));
    for (const phrase of ["Mark as triaged", "conflict check", "Lead consultant"]) {
      expect(JSON.stringify(en), phrase).toContain(phrase);
      expect(signIn, phrase).not.toContain(phrase);
    }
  });

  it("picks only what is named, and skips a name the catalogue lacks", () => {
    expect(pickNamespaces({ a: 1, b: { c: 2 }, d: 3 }, ["b", "zz"])).toEqual({ b: { c: 2 } });
    expect(pickNamespaces({ a: 1 }, [])).toEqual({});
  });
});

describe("Latin pieces inside Arabic sentences on signed-out pages", () => {
  it("the upload page's list of file types is one piece the page can set left to right", () => {
    for (const locale of ["ar", "en"] as const) {
      const t = createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "uploadLink" });
      const shown = t.markup("rules", { types: () => "<bdi dir=\"ltr\">.pdf .docx</bdi>", mb: 25 });
      expect(shown).toContain('(<bdi dir="ltr">.pdf .docx</bdi>)');
      expect(shown).toContain("25");
    }
    expect(readFileSync(`${APP}/(public)/upload/[token]/upload-form.tsx`, "utf8")).toContain('<bdi dir="ltr">{ACCEPTED_EXTENSIONS');
  });

  it("the inquiry confirmation keeps the e-mail address in one left-to-right piece", () => {
    const form = readFileSync(`${APP}/(public)/inquiry/inquiry-form.tsx`, "utf8");
    expect(form).toMatch(/<bdi dir="ltr" className="inline-block[^"]*">\s*\{email\}/);
    for (const messages of [ar, en]) expect(messages.inquiry.sent.body).toContain("<email></email>");
  });
});

describe("the files that hand the strings over", () => {
  it("each pass the picked namespaces of their own area, never the catalogue", () => {
    for (const area of AREAS) {
      const source = readFileSync(PROVIDERS[area], "utf8");
      expect(source, PROVIDERS[area]).toContain(`signedOutMessages(messages, "${area}")`);
    }
  });

  it("no signed-out file renders a provider without naming its messages", () => {
    // <NextIntlClientProvider> with no `messages` prop inherits every string there is.
    const files = [...sources(`${APP}/(auth)`), ...sources(`${APP}/(public)`), `${APP}/not-found.tsx`];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const tag of source.match(/<NextIntlClientProvider\b[^>]*>/g) ?? []) {
        expect(tag, file).toMatch(/\bmessages=\{signedOutMessages\(messages, "[a-z]+"\)\}/);
      }
      expect(source, file).not.toMatch(/messages=\{messages\}/);
    }
  });

  it("the root layout still hands client components nothing", () => {
    expect(readFileSync(`${APP}/layout.tsx`, "utf8")).toContain("<NextIntlClientProvider messages={null}>");
  });

  it("every string a signed-out client component reads is among those passed to it", () => {
    for (const area of AREAS) {
      const passed: readonly string[] = SIGNED_OUT_NAMESPACES[area];
      for (const file of sources(FOLDERS[area])) {
        const source = readFileSync(file, "utf8");
        if (!/^"use client";/.test(source)) continue;
        for (const m of source.matchAll(/useTranslations\(\s*"([A-Za-z]+)/g)) {
          expect(passed, `${file} reads "${m[1]}"`).toContain(m[1]);
        }
        // A client component must name the namespace it reads, so this check can see it.
        expect(source, file).not.toMatch(/useTranslations\(\s*\)/);
      }
    }
  });
});

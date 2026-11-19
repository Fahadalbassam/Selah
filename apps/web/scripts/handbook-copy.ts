// Copies the role guides from docs/handbook/ into the app (src/lib/handbook-content.ts),
// so the in-app Help can show each role its own part (big prompt 6.2). The web image
// is built from apps/web alone, so the app cannot read docs/ at run time.
//
//   npm run handbook:copy          write the copy
//   npm run handbook:copy -- --check   only say whether the copy is up to date (exit 1 if not)
//
// A guide is found at the first of these that exists, for each part (firm, client:
// the handbook writes docs/handbook/firm/ar.md and so on) and language (ar, en):
//   docs/handbook/<name>.<lang>.md · docs/handbook/<lang>/<name>.md
//   docs/handbook/<name>/<lang>.md · docs/handbook/<name>/index.<lang>.md
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_PARTS, GUIDE_SOURCES, type GuideLocale, type GuidePart } from "../src/lib/handbook";

const here = dirname(fileURLToPath(import.meta.url));
export const HANDBOOK_DIR = resolve(here, "../../../docs/handbook");
export const CONTENT_FILE = resolve(here, "../src/lib/handbook-content.ts");
const LOCALES: GuideLocale[] = ["ar", "en"];

export function guidePaths(dir: string, part: GuidePart, locale: GuideLocale): string[] {
  const name = GUIDE_SOURCES[part];
  return [join(dir, `${name}.${locale}.md`), join(dir, locale, `${name}.md`), join(dir, name, `${locale}.md`), join(dir, name, `index.${locale}.md`)];
}

/** The guides as written in docs/handbook/: only the ones that exist and say something. */
export function collectHandbook(dir: string = HANDBOOK_DIR): Partial<Record<GuidePart, Partial<Record<GuideLocale, string>>>> {
  const out: Partial<Record<GuidePart, Partial<Record<GuideLocale, string>>>> = {};
  for (const part of GUIDE_PARTS) {
    for (const locale of LOCALES) {
      const file = guidePaths(dir, part, locale).find((p) => existsSync(p));
      if (!file) continue;
      const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim();
      if (text) (out[part] ??= {})[locale] = text;
    }
  }
  return out;
}

export function renderContent(content: ReturnType<typeof collectHandbook>): string {
  return [
    "// Written by `npm run handbook:copy` from docs/handbook/ (scripts/handbook-copy.ts). Do not edit by hand.",
    `export const HANDBOOK: Partial<Record<"firm" | "client", Partial<Record<"ar" | "en", string>>>> = ${JSON.stringify(content, null, 2)};`,
    "",
  ].join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const next = renderContent(collectHandbook());
  const now = existsSync(CONTENT_FILE) ? readFileSync(CONTENT_FILE, "utf8").replace(/\r\n?/g, "\n") : "";
  if (process.argv.includes("--check")) {
    if (now !== next) {
      console.error("src/lib/handbook-content.ts is not the same as docs/handbook/. Run: npm run handbook:copy");
      process.exit(1);
    }
    console.log("The handbook copy is up to date.");
  } else {
    writeFileSync(CONTENT_FILE, next);
    console.log(now === next ? "The handbook copy was already up to date." : "Wrote src/lib/handbook-content.ts.");
  }
}

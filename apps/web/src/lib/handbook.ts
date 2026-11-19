// The handbook in the app (big prompt 6.2): Help links each role to its own
// part of the handbook, and nothing else. The guides are written in
// `docs/handbook/` (Arabic and English); `npm run handbook:copy` copies them
// into `handbook-content.ts` so the app carries them (the web image is built
// from `apps/web` alone), and tests/help-in-app.test.ts fails when the copy and
// the files in `docs/handbook/` differ. Until a guide is written, its part is
// empty: no link, no page (a 404), never a placeholder.
//
// Plain module: the Help page, the guide page, the user menu and the tests
// share it. It decides which text a reader is shown, never who may see data.

import type { Role } from "@/authz";
import { HANDBOOK } from "./handbook-content";

/** The handbook's parts a reader can open from the app. */
export const GUIDE_PARTS = ["firm", "client"] as const;
export type GuidePart = (typeof GUIDE_PARTS)[number];
export type GuideLocale = "ar" | "en";

/**
 * Where each part is written in `docs/handbook/`, by its file name: the firm
 * guide (firm admin, lead, deputy, consultant, observer) and the client guide
 * (client admin, client manager, action owner).
 */
export const GUIDE_SOURCES: Record<GuidePart, string> = { firm: "firm", client: "client" };

/**
 * Where the reader's own role starts in their guide: the section ids the
 * handbook writes above each part (`<a id="client-admin"></a>`), the same in
 * both languages. The firm guide's "lead" and "deputy" are a consultant's
 * roles on a client, so a consultant starts at "consultant".
 */
const ROLE_ANCHOR: Record<Role, string> = {
  firm_admin: "firm-admin",
  consultant: "consultant",
  client_admin: "client-admin",
  client_manager: "client-manager",
  action_owner: "action-owner",
};

/** The link to the reader's own part of the handbook, opened at their role. */
export function guideHrefFor(role: Role): string {
  return `${GUIDE_HREF}#${ROLE_ANCHOR[role]}`;
}

/** Each role sees only its own part. */
const PART_OF: Record<Role, GuidePart> = {
  firm_admin: "firm",
  consultant: "firm",
  client_admin: "client",
  client_manager: "client",
  action_owner: "client",
};

export function guidePartFor(role: Role): GuidePart {
  return PART_OF[role];
}

/** The role's guide in the reader's language, else in the other one; null until it is written. */
export function guideFor(role: Role, locale: string, content: typeof HANDBOOK = HANDBOOK): { part: GuidePart; locale: GuideLocale; text: string } | null {
  const part = guidePartFor(role);
  const texts = content[part] ?? {};
  const first: GuideLocale = locale === "en" ? "en" : "ar";
  for (const l of [first, first === "ar" ? "en" : "ar"] as const) {
    const text = texts[l]?.trim();
    if (text) return { part, locale: l, text };
  }
  return null;
}

/** Where the guide opens in the app. */
export const GUIDE_HREF = "/help/guide";

// ---- Reading the Markdown the handbook is written in ----
//
// A small reader for what a handbook page uses: headings, paragraphs, lists,
// simple tables, quotes, **bold**, `code` and links. It builds plain data the
// page draws as React elements, so nothing in a guide is ever run as HTML.
// Images are left out (the screenshots live in the repository, not in the
// app); a link opens only an address inside Selah ("/…") or a heading on the
// page ("#…"), anything else is drawn as its text.

export type Inline = { kind: "text" | "strong" | "code"; text: string } | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "anchor"; id: string }
  // id is "" when the page already has it (a section id written above, or an earlier heading of the same words).
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: Inline[]; id: string }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "quote"; text: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

// An address inside Selah ("/…"; never "//…" or "/\…", which browsers read as another site), or a heading ("#…").
const SAFE_HREF = /^(\/(?![/\\])|#)/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (kind: "text" | "strong" | "code", text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (kind === "text" && last?.kind === "text") last.text += text;
    else out.push({ kind, text });
  };
  // Images first (dropped), then links, code, bold.
  const re = /!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__/g;
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    push("text", src.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[0].startsWith("!")) continue;
    if (m[1] !== undefined) {
      const href = m[2]!;
      if (SAFE_HREF.test(href)) out.push({ kind: "link", text: m[1], href });
      else push("text", m[1]);
    } else if (m[3] !== undefined) push("code", m[3]);
    else push("strong", (m[4] ?? m[5])!);
  }
  push("text", src.slice(at));
  return out;
}

/** A heading's anchor: its words, lower case, joined by "-" (Arabic letters kept). */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

const plain = (parts: Inline[]) => parts.map((p) => p.text).join("");
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function parseGuide(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  // Every id on the page once: a section id written in the file wins over a heading's own ("### Firm admin" under <a id="firm-admin">).
  const used = new Set([...md.matchAll(/^\s*<a\s+id="([A-Za-z0-9_-]+)"\s*><\/a>\s*$/gm)].map((m) => m[1]!));
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    // A section's id, written as <a id="…"></a> above it (the same ids in both languages).
    const anchor = /^<a\s+id="([A-Za-z0-9_-]+)"\s*><\/a>$/.exec(t);
    if (anchor) {
      flush();
      blocks.push({ kind: "anchor", id: anchor[1]! });
      continue;
    }
    // Any other HTML is not drawn.
    if (/^<\/?[a-z][^>]*>.*>$|^<\/?[a-z][^>]*>$/i.test(t)) {
      flush();
      continue;
    }
    // A line of links only to other files of the handbook (its front page, the other parts) leads nowhere in the app.
    if (/^(\[[^\]]+\]\((?![/#])[^)]+\)\s*(·|\|)?\s*)+$/.test(t)) {
      flush();
      continue;
    }
    // HTML comments (notes for writers) and fenced code are not drawn.
    if (t.startsWith("<!--")) {
      flush();
      while (i < lines.length && !lines[i]!.includes("-->")) i++;
      continue;
    }
    if (t.startsWith("```")) {
      flush();
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      const text = parseInline(h[2]!.replace(/\s+#+$/, ""));
      const id = slug(plain(text));
      blocks.push({ kind: "heading", level: h[1]!.length as 1 | 2 | 3 | 4, text, id: used.has(id) ? "" : id });
      used.add(id);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      continue;
    }
    if (t.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1]!.trim())) {
      flush();
      const head = cells(t).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!).map(parseInline));
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const item = /^([-*+]|\d+[.)])\s+(.*)$/.exec(t);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1]!);
      const items: string[] = [item[2]!];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(next);
        if (m && /\d/.test(m[1]!) === ordered) items.push(m[2]!);
        else if (next.trim() && /^\s{2,}/.test(next) && !m) items[items.length - 1] += ` ${next.trim()}`;
        else break;
        i++;
      }
      blocks.push({ kind: "list", ordered, items: items.map(parseInline) });
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      const quote: string[] = [t.replace(/^>\s?/, "")];
      while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith(">")) quote.push(lines[++i]!.trim().replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: parseInline(quote.join(" ")) });
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}

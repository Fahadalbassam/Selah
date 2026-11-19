// Phase 2, part A (big prompt 6.1 and 6.2): the first-visit hints for each
// role on the home's two-week welcome, and Help linking each role to its own
// part of the handbook only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { collectHandbook, HANDBOOK_DIR, renderContent, CONTENT_FILE } from "../scripts/handbook-copy";
import type { Role } from "@/authz";
import { guideFor, guideHrefFor, guidePartFor, parseGuide, parseInline } from "@/lib/handbook";
import { userMenuFor } from "@/lib/nav";
import { welcomeFor, WELCOME_LINKS } from "@/lib/welcome";

const ROLES: Role[] = ["firm_admin", "consultant", "client_admin", "client_manager", "action_owner"];
const at = (m: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);
const src = (p: string) => readFileSync(join(__dirname, "../src", p), "utf8");

describe("first-visit hints, one short set for each role", () => {
  it("say what the home is for and the first two or three things to do, in both languages", () => {
    for (const role of ROLES) {
      const w = welcomeFor(role);
      for (const m of [ar, en]) {
        const home = at(m.welcome, w.home);
        expect(home, role).toEqual(expect.any(String));
        expect((home as string).length, role).toBeLessThanOrEqual(160);
        const steps = at(m.welcome, w.steps) as { title: string; hint: string }[];
        expect(steps.length, role).toBeGreaterThanOrEqual(2);
        expect(steps.length, role).toBeLessThanOrEqual(3);
        expect(w.links.length, role).toBe(steps.length);
      }
    }
  });

  it("are chosen by the reader's role: each role reads its own line", () => {
    const lines = ROLES.map((r) => at(en.welcome, welcomeFor(r).home));
    expect(new Set(lines).size).toBe(ROLES.length);
    expect(welcomeFor("action_owner").links).toEqual(WELCOME_LINKS.action_owner);
    expect(at(ar.welcome, welcomeFor("client_admin").home)).toContain("شركتك");
  });

  it("are the existing welcome on the home, never a tour that covers the screen", () => {
    const page = src("app/(app)/page.tsx");
    expect(page).toContain("welcomeFor(viewer.role)");
    expect(page).toContain("purpose={tW(hints.home)}");
    const welcome = src("components/welcome.tsx");
    expect(welcome).toContain("<section");
    expect(welcome).not.toMatch(/fixed inset-0|Dialog|aria-modal/);
  });
});

describe("Help links the handbook, each role to its own part only", () => {
  const sample = { firm: { ar: "# دليل المكتب\n\nنص.", en: "# Firm guide\n\nText." }, client: { ar: "# دليل العميل\n\nنص.", en: "# Client guide\n\nText." } };

  it("gives firm staff the firm guide and the client's people the client guide, opened at their own role", () => {
    expect(ROLES.map(guidePartFor)).toEqual(["firm", "firm", "client", "client", "client"]);
    expect(guideFor("client_manager", "ar", sample)).toEqual({ part: "client", locale: "ar", text: sample.client.ar });
    expect(guideFor("consultant", "en", sample)?.text).toBe(sample.firm.en);
    expect(guideFor("action_owner", "en", sample)?.text).not.toContain("Firm");
    expect(ROLES.map(guideHrefFor)).toEqual([
      "/help/guide#firm-admin",
      "/help/guide#consultant",
      "/help/guide#client-admin",
      "/help/guide#client-manager",
      "/help/guide#action-owner",
    ]);
  });

  it("shows nothing until the guide is written: no link and no page", () => {
    expect(guideFor("client_admin", "ar", {})).toBeNull();
    expect(guideFor("firm_admin", "en", { client: sample.client })).toBeNull();
    // The other language when the reader's is not written yet.
    expect(guideFor("client_admin", "ar", { client: { en: "# Client guide" } })?.locale).toBe("en");
    const help = src("app/(app)/help/page.tsx");
    expect(help).toMatch(/\{guide \? \(\s*<Link href=\{guideHrefFor\(role\)\}/);
    expect(src("app/(app)/help/guide/page.tsx")).toMatch(/if \(!guide\) notFound\(\);/);
  });

  it("puts the firm guide in firm staff's own menu (they have no Help page), never the client's people's", () => {
    expect(userMenuFor("consultant", { guide: true }).map((i) => i.href)).toContain("/help/guide#consultant");
    expect(userMenuFor("firm_admin", { guide: false }).map((i) => i.key)).not.toContain("guide");
    for (const r of ["client_admin", "client_manager", "action_owner"] as Role[]) {
      expect(userMenuFor(r, { guide: true }).map((i) => i.key)).not.toContain("guide");
    }
  });

  it("has its words in both languages", () => {
    for (const m of [ar, en]) {
      for (const k of ["open", "title.firm", "title.client", "description.firm", "description.client"]) expect(at(m.help.guide, k), k).toEqual(expect.any(String));
      expect(m.nav.guide).toEqual(expect.any(String));
    }
  });

  it("the app's copy is the handbook as written in docs/handbook (run npm run handbook:copy after changing it)", () => {
    expect(readFileSync(CONTENT_FILE, "utf8").replace(/\r\n?/g, "\n")).toBe(renderContent(collectHandbook()));
  });

  it("finds each role's section in the guides once they are written, in both languages", () => {
    const content = collectHandbook();
    for (const role of ROLES) {
      const anchor = guideHrefFor(role).split("#")[1]!;
      for (const l of ["ar", "en"] as const) {
        const text = content[guidePartFor(role)]?.[l];
        if (!text) continue;
        expect(parseGuide(text).some((b) => b.kind === "anchor" && b.id === anchor), `${role} ${l}`).toBe(true);
      }
    }
    if (!existsSync(HANDBOOK_DIR)) expect(content).toEqual({});
  });
});

describe("reading a guide's Markdown", () => {
  it("keeps section ids, lists and tables, and never draws HTML or links out of the app", () => {
    const blocks = parseGuide(
      [
        "# Client guide",
        "[Handbook front page](../en.md) · [What Selah will not do](../limits/en.md)",
        '<a id="stuck"></a>',
        "## Say you are stuck",
        "1. Open the action.",
        "2. Press **I am stuck**.",
        "<script>alert(1)</script>",
        "| Word | Means |",
        "|---|---|",
        "| Verified | Checked |",
        "See [Help](/help) and [the start](#roles) and [a site](https://example.com) ![shot](a.png).",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "anchor", "heading", "list", "table", "paragraph"]);
    expect(blocks[1]).toEqual({ kind: "anchor", id: "stuck" });
    const last = blocks[5]!;
    expect(last.kind === "paragraph" && last.text.filter((p) => p.kind === "link").map((p) => (p as { href: string }).href)).toEqual(["/help", "#roles"]);
    expect(JSON.stringify(blocks)).not.toContain("script");
    // Browsers read "//host", "/\host" and "\\host" as another site: drawn as text, never as a link.
    for (const href of ["//evil.example", "/\\evil.example", "\\\\evil.example", "\\evil.example", "https://evil.example", "javascript:void"]) {
      expect(parseInline(`[x](${href})`), href).toEqual([{ kind: "text", text: "x" }]);
    }
    expect(parseInline("[Help](/help)")).toEqual([{ kind: "link", text: "Help", href: "/help" }]);
  });

  it("gives each id once: a written section id wins over its heading's own", () => {
    const blocks = parseGuide(['<a id="firm-admin"></a>', "### Firm admin", "## Notes", "## Notes"].join("\n"));
    expect(blocks).toMatchObject([
      { kind: "anchor", id: "firm-admin" },
      { kind: "heading", id: "" },
      { kind: "heading", id: "notes" },
      { kind: "heading", id: "" },
    ]);
  });

  // Phase 3 leftovers, item 11: the English firm guide drew firm-admin, deputy, consultant and observer twice,
  // and "the Arabic guide is ar.md" printed the bare file name, since a link to another file is drawn as its text.
  it("has no id twice and no bare file name in the real guides", () => {
    const content = collectHandbook();
    for (const [part, texts] of Object.entries(content)) {
      for (const [l, text] of Object.entries(texts ?? {})) {
        if (!text) continue;
        const blocks = parseGuide(text);
        const ids = blocks.flatMap((b) => (b.kind === "anchor" || b.kind === "heading" ? [b.id] : [])).filter(Boolean);
        expect(ids.length, `${part} ${l}`).toBe(new Set(ids).size);
        expect(JSON.stringify(blocks), `${part} ${l}`).not.toMatch(/\b(ar|en)\.md\b/);
      }
    }
  });
});

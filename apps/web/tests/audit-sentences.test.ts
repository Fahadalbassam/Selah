// Batch 5: the audit log in plain words. Each entry reads as one sentence a
// client admin understands, Arabic first ("<what>, by <who>", so the verb
// never guesses the person's gender), English "<who> <did what>."; the code
// names, record ids, addresses and raw details sit behind "Details".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { auditActionKey, auditLine } from "@/lib/audit";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|sql)$/.test(f) ? [p] : [];
  });

/** Actions the app writes (the same reading as audit-labels.test.ts). */
function writtenActions(): string[] {
  const out = new Set<string>();
  for (const f of [...files(`${root}src`), ...files(`${root}drizzle`)]) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/action: "([a-z_]+(?:\.[a-z_]+)+)"/g)) out.add(m[1]!);
    if (f.replaceAll("\\", "/").endsWith("src/auth/auth.ts")) for (const m of text.matchAll(/"(auth(?:\.[a-z_]+)+)"/g)) out.add(m[1]!);
    for (const m of text.matchAll(/INSERT INTO audit_log[^;]*;/g)) for (const a of m[0].matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)) out.add(a[1]!);
  }
  return [...out].sort();
}

const sentences = (m: unknown) => (m as { audit: { sentences?: Record<string, string> } }).audit.sentences ?? {};

/** The sentence the screen draws, as plain text. */
function say(locale: "ar" | "en", e: { action: string; outcome: string; meta?: Record<string, unknown> }, name: string) {
  const messages = locale === "ar" ? ar : en;
  const t = createTranslator({ locale, messages, namespace: "audit" });
  const ts = createTranslator({ locale, messages, namespace: "status" });
  const l = auditLine({ ...e, meta: e.meta ?? {} }, (k) => k in sentences(messages));
  const event =
    l.event.kind === "sentence"
      ? t(`sentences.${l.event.key}` as never, (l.event.from ? { from: ts(l.event.from as never), to: ts(l.event.to as never) } : {}) as never)
      : t(`actions.${l.event.key}` as never);
  return t.rich(l.line, { name, event, who: (c) => c }) as unknown as string;
}

describe("every written action has a sentence", () => {
  const written = writtenActions();
  it.each([
    ["ar", ar],
    ["en", en],
  ])("%s", (_, m) => {
    expect(written.filter((a) => !sentences(m)[auditActionKey(a)])).toEqual([]);
  });

  it("only the status change takes values, and it takes both", () => {
    for (const m of [ar, en]) {
      for (const [k, v] of Object.entries(sentences(m))) {
        const holes = [...v.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
        expect(holes, k).toEqual(k === "action_transition" ? ["from", "to"] : []);
      }
    }
  });

  it("no sentence uses a code name, a record id or the word reserved for verifying an action", () => {
    for (const [k, v] of Object.entries(sentences(ar))) {
      expect(v, k).not.toMatch(/[a-z_]+\.[a-z_]+|[{}]{2}/);
      if (!/sign_off|second_review/.test(k)) expect(v, k).not.toMatch(/اعتماد|اعتمد/);
    }
    for (const [k, v] of Object.entries(sentences(en))) expect(v, k).not.toMatch(/[a-z]+_[a-z]+|\buuid\b|\bhash\b/i);
  });
});

describe("one word per thing (page audit 4.7, review N4)", () => {
  it("an inquiry is «الطلب» in the audit log, as on its page and in the sidebar", () => {
    const a = (ar as unknown as { audit: Record<string, Record<string, string>> }).audit;
    for (const group of ["sentences", "actions", "areas"]) {
      for (const [k, v] of Object.entries(a[group] ?? {})) expect(v, `${group}.${k}`).not.toMatch(/استفسار/);
    }
    expect(a.sentences!.inquiry_convert).toMatch(/طلب/);
  });
});

describe("the sentences, in both languages", () => {
  it("a sign-in", () => {
    expect(say("ar", { action: "auth.sign_in", outcome: "allow" }, "سارة")).toBe("تسجيل الدخول، بواسطة سارة");
    expect(say("en", { action: "auth.sign_in", outcome: "allow" }, "Sara")).toBe("Sara signed in.");
  });

  it("a status change names both states", () => {
    const e = { action: "action.transition", outcome: "allow", meta: { from: "in_progress", to: "awaiting_review" } };
    expect(say("ar", e, "خالد")).toBe("نقل إجراء من «قيد التنفيذ» إلى «بانتظار المراجعة»، بواسطة خالد");
    expect(say("en", e, "Khalid")).toBe("Khalid moved an action from In progress to Awaiting review.");
  });

  it("a status change without its states still reads as a sentence", () => {
    const l = auditLine({ action: "action.transition", outcome: "allow", meta: {} });
    expect(l.event.kind).toBe("label");
  });

  it("a refused attempt says it was refused, with what was tried", () => {
    expect(say("ar", { action: "document.download", outcome: "deny" }, "سارة")).toMatch(/^رُفضت محاولة من سارة: /);
    expect(say("en", { action: "document.download", outcome: "deny" }, "Sara")).toMatch(/^Sara tried this and was refused: /);
    expect(auditLine({ action: "document.download", outcome: "error", meta: {} }).line).toBe("lineFailed");
  });

  it("an action with no sentence falls back to its label, never to the code name", () => {
    const l = auditLine({ action: "project.read", outcome: "allow", meta: {} }, (k) => k in sentences(en));
    expect(l.line).toBe("lineLabel");
  });
});

describe("the screen", () => {
  const page = readFileSync(join(root, "src/app/(app)/audit/page.tsx"), "utf8");
  it("draws the sentence, and the code name only behind Details", () => {
    expect(page).toContain("auditLine(");
    const row = page.slice(page.indexOf("<TableBody>"));
    const details = row.indexOf("showDetails");
    expect(details).toBeGreaterThan(0);
    // The raw action code and the record id come after the Details trigger, inside it.
    expect(row.indexOf("{e.action}")).toBeGreaterThan(details);
    expect(row.indexOf("e.resourceId")).toBeGreaterThan(details);
  });
});

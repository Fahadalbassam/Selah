// Batch 5, the October review's items it carries (page audit section 7):
// 3 the Projects cards' next due date and one "New project" whose first field
// is the kind; 7 dense rows on the Documents list and the People page's one
// "Access" section; 14 the pages kept, each with a one-line reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const get = (o: unknown, key: string): unknown => key.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);

describe("item 3: Projects", () => {
  const page = source("app/(app)/projects/page.tsx");
  const dialog = source("app/(app)/projects/new-project.tsx");

  it("has one New project button, no second one for internal projects", () => {
    expect(page).toContain("<NewProjectDialog");
    expect(page).not.toContain("newInternal");
    expect(page).not.toContain("<FormDialog");
  });

  it("the dialog's first field is the kind", () => {
    const fields = [...dialog.matchAll(/htmlFor="np-(\w+)"/g)].map((m) => m[1]);
    expect(fields[0]).toBe("kind");
    expect(fields).toEqual(["kind", "client", "title", "description"]);
  });

  it("each card shows the next due date, from the actions the reader may read", () => {
    expect(page).toContain("p.nextDue");
    expect(source("services/queries.ts")).toMatch(/nextDue:[\s\S]*OPEN_STATUSES/);
  });
});

describe("item 7: dense rows", () => {
  it("Documents: the version only when there is more than one, who added it and when, the assistant in the row menu", () => {
    const p = source("app/(app)/projects/[id]/page.tsx");
    expect(p).toContain("d.version > 1");
    expect(p).toContain("files.addedBy");
    expect(p).not.toContain('t("aiIndexed")');
    expect(p).toContain("assistantReads={");
    expect(source("components/file-actions.tsx")).toContain('t("assistantReads")');
  });

  it("People: invitations, mail domains and the access review fold behind one Access section", () => {
    const p = source("app/(app)/team/people-admin.tsx");
    const access = p.slice(p.indexOf("<AccessSection"), p.indexOf("</AccessSection>"));
    for (const piece of ['t("invitations")', 't("domains")', 't("review")']) expect(access, piece).toContain(piece);
  });

  it.each([
    ["ar", ar],
    ["en", en],
  ])("%s words", (_, m) => {
    for (const k of ["people.access.title", "people.access.invitations", "fileActions.assistantReads", "projects.nextDue", "projects.new.kind"]) {
      expect(typeof get(m, k), k).toBe("string");
    }
  });
});

describe("item 14: the kept pages", () => {
  it("each has its one-line reason in docs/ui-guidelines.md", () => {
    const doc = readFileSync(join(__dirname, "../../../docs/ui-guidelines.md"), "utf8");
    const kept = doc.slice(doc.indexOf("### Pages kept"));
    for (const p of ["/inquiries", "/templates", "/audit", "/engagements/:id", "/assistant", "/projects/:id/import"]) expect(kept, p).toContain(`\`${p}\``);
  });
});

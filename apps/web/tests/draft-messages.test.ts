// What the firm is told on a draft action (decision D6 and its review): the
// line shown before Release when the named owner has gone, and the panel's
// mapping of the database's refusal to that same line. Both languages.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const panel = readFileSync("src/app/(app)/actions/[id]/action-panel.tsx", "utf8");

describe("a draft whose named owner has gone", () => {
  it("has its own plain line in Arabic and English, not 'someone else changed this action'", () => {
    expect(en.action.errors.ownerGone).toBe(
      "The person named on this action no longer has an account on the project. Name someone else before releasing.",
    );
    expect(ar.action.errors.ownerGone).toMatch(/[؀-ۿ]/);
    expect(ar.action.errors.ownerGone).not.toBe(ar.action.errors.conflict);
  });

  it("the panel maps the database's refusal to it before falling back to a conflict, and shows it on the draft", () => {
    const mapped = panel.indexOf(`"owner must be an active member")) return { ok: false, error: "ownerGone" }`);
    expect(mapped).toBeGreaterThan(-1);
    expect(mapped).toBeLessThan(panel.indexOf(`if (res.status === 409) return { ok: false, error: "conflict" }`));
    expect(panel).toContain(`status === "draft" && ownerGone ? <p className="text-sm text-destructive">{t("errors.ownerGone")}</p>`);
  });
});

describe("the firm's own view of a draft", () => {
  const page = readFileSync("src/app/(app)/actions/[id]/page.tsx", "utf8");

  it("says in one muted line, in both languages, that the client sees nothing yet and will read the thread after release", () => {
    expect(en.action.draftNotice).toBe("Not visible to the client until you release it. Comments here become visible to the client after release.");
    expect(ar.action.draftNotice).toMatch(/[؀-ۿ]/);
    expect(page).toContain(`firmView && action.status === "draft" ? (`);
  });

  it("is not 'until you release it' for someone who cannot release it, an observer (screen re-check of batch 0)", () => {
    expect(en.action.draftNoticeReader).toBe("Not visible to the client until it is released. Comments here become visible to the client after release.");
    expect(ar.action.draftNoticeReader).toMatch(/[؀-ۿ]/);
    // Release is the move to "assigned"; the page offers only the moves the reader may make.
    expect(page).toContain(`t(data.moves.includes("assigned") ? "draftNotice" : "draftNoticeReader")`);
  });
});

describe("a draft offered as a replacement", () => {
  it("is refused in plain words in both languages", () => {
    expect(en.action.errors.replacementDraft).toBe("The replacement is still a draft the client can't see. Release it first.");
    expect(ar.action.errors.replacementDraft).toMatch(/[؀-ۿ]/);
    const mapped = panel.indexOf(`"replacement is still a draft")) return { ok: false, error: "replacementDraft" }`);
    expect(mapped).toBeGreaterThan(-1);
    expect(mapped).toBeLessThan(panel.indexOf(`if (res.status === 409) return { ok: false, error: "conflict" }`));
  });
});

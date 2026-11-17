// Who sees an item (feature A of the 17 Nov 2026 decision), the screen half:
// the picker's quiet line, its locked chips and its refusal of an empty
// "only" list, rendered to HTML with the real messages; and the pure rules it
// shares with the server (lib/audience.ts).
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { AudienceDropped } from "@/components/audience-field";
import { AudienceMarker } from "@/components/audience-marker";
import { AudiencePicker, type AudiencePickerProps } from "@/components/audience-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AUDIENCE_LOCK_REASONS,
  audienceGroups,
  audienceMode,
  audienceRefusal,
  audienceSelection,
  audienceToSave,
  reconcileAudience,
  switchAudience,
  type AudiencePerson,
} from "@/lib/audience";

const html = (locale: "ar" | "en", node: ReactNode) => {
  // The provider's props type asks for children; they go in as createElement's third argument.
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, createElement(TooltipProvider, null, node)));
};

const people: AudiencePerson[] = [
  { id: "me", name: { ar: "سارة", en: "Sara" }, side: "firm", locked: "self" },
  { id: "omar", name: { ar: "عمر", en: "Omar" }, side: "firm", hint: "omar@mizan.example" },
  { id: "admin", name: { ar: "ليلى", en: "Layla" }, side: "client", locked: "clientAdmin" },
  { id: "khaled", name: { ar: "خالد", en: "Khaled" }, side: "client" },
  { id: "huda", name: { ar: "هدى", en: "Huda" }, side: "client" },
];

const picker = (locale: "ar" | "en", props: Partial<AudiencePickerProps>) =>
  html(locale, createElement(AudiencePicker, { kind: "document", mode: "everyone", people, selected: [], onChange: () => undefined, ...props }));

const summary = (out: string) => out.match(/data-slot="audience-summary">([^<]*)</)?.[1];

describe("the picker, closed: one quiet line", () => {
  it("says everyone with access by default, with Customise, in both languages", () => {
    expect(summary(picker("ar", {}))).toBe("يراه: كل من له صلاحية");
    expect(picker("ar", {})).toContain(">تخصيص<");
    expect(summary(picker("en", {}))).toBe("Seen by: everyone with access");
    expect(picker("en", {})).toContain(">Customise<");
  });

  it("counts the people left out", () => {
    expect(summary(picker("ar", { mode: "except", selected: ["omar", "khaled"] }))).toBe("يراه: الجميع عدا شخصين");
    expect(summary(picker("en", { mode: "except", selected: ["omar", "khaled"] }))).toBe("Seen by: everyone except 2 people");
  });

  it("counts everyone on an 'only' list, the locked people included", () => {
    expect(summary(picker("ar", { mode: "only", selected: ["khaled"] }))).toBe("يراه: فقط 3 أشخاص");
    expect(summary(picker("en", { mode: "only", selected: ["khaled"] }))).toBe("Seen by: only 3 people");
  });

  it("shows nothing of the switch or the list until opened", () => {
    const out = picker("ar", { mode: "except", selected: ["omar"] });
    expect(out).not.toContain(ar.audience.position.except);
    expect(out).not.toContain('data-slot="combobox-chips"');
  });

  it("ignores a locked person or a stranger handed in as left out", () => {
    // A locked person can never be left out, and nobody outside the list can be picked.
    expect(summary(picker("en", { mode: "except", selected: ["me", "someone-else"] }))).toBe("Seen by: everyone with access");
  });
});

describe("the closed line's plural forms", () => {
  const line = (locale: "ar" | "en", key: "except" | "only", n: number) =>
    createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "audience.summary" })(key, { n });

  it("in Arabic: one, two, a few, many and other", () => {
    expect(line("ar", "except", 1)).toBe("يراه: الجميع عدا شخص واحد");
    expect(line("ar", "except", 2)).toBe("يراه: الجميع عدا شخصين");
    expect(line("ar", "except", 3)).toBe("يراه: الجميع عدا 3 أشخاص");
    expect(line("ar", "except", 11)).toBe("يراه: الجميع عدا 11 شخصًا");
    expect(line("ar", "except", 100)).toBe("يراه: الجميع عدا 100 شخص");
    expect(line("ar", "only", 1)).toBe("يراه: فقط شخص واحد");
    expect(line("ar", "only", 2)).toBe("يراه: فقط شخصان");
    expect(line("ar", "only", 3)).toBe("يراه: فقط 3 أشخاص");
    expect(line("ar", "only", 11)).toBe("يراه: فقط 11 شخصًا");
  });

  it("in English: one person, several people", () => {
    expect(line("en", "except", 1)).toBe("Seen by: everyone except one person");
    expect(line("en", "except", 5)).toBe("Seen by: everyone except 5 people");
    expect(line("en", "only", 1)).toBe("Seen by: only one person");
    expect(line("en", "only", 3)).toBe("Seen by: only 3 people");
  });
});

describe("the picker, opened", () => {
  it("offers the two positions, 'except' chosen by default", () => {
    const out = picker("ar", { defaultOpen: true });
    expect(out).toContain(`>${ar.audience.position.except}<`);
    expect(out).toContain(`>${ar.audience.position.only}<`);
    expect(out).toMatch(/aria-checked="true"[^>]*>[^<]*>?كل من له صلاحية، عدا…</);
    expect(out).toContain('aria-label="من يرى هذا الملف"');
    expect(picker("en", { defaultOpen: true, kind: "meeting" })).toContain('aria-label="Who sees this meeting"');
  });

  it("shows locked people as chips with no remove button, and the reason, on an 'only' list", () => {
    const out = picker("ar", { defaultOpen: true, mode: "only", selected: ["khaled"] });
    const chips = [...out.matchAll(/<div[^>]*data-slot="combobox-chip"[^>]*>/g)].map((m) => m[0]);
    expect(chips).toHaveLength(3);
    const locked = chips.filter((c) => c.includes('data-removable="false"'));
    expect(locked.map((c) => c.match(/aria-label="([^"]*)"/)?.[1])).toEqual(["سارة", "ليلى"]);
    expect(locked[0]).toContain(`aria-description="${ar.audience.locked.self}"`);
    expect(locked[1]).toContain(`aria-description="${ar.audience.locked.clientAdmin}"`);
    // Only the person who may go has a remove button.
    expect(out).toContain('aria-label="إزالة خالد"');
    expect(out).not.toContain('aria-label="إزالة سارة"');
    expect(out).not.toContain('aria-label="إزالة ليلى"');
    expect(picker("en", { defaultOpen: true, mode: "only", selected: ["khaled"] })).toContain('aria-label="Remove Khaled"');
  });

  it("shows only the people left out as chips on an 'except' list, never a locked one", () => {
    const out = picker("en", { defaultOpen: true, mode: "except", selected: ["omar", "admin"] });
    const chips = [...out.matchAll(/<div[^>]*data-slot="combobox-chip"[^>]*>/g)].map((m) => m[0]);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toContain('aria-label="Omar"');
    expect(out).toContain(`aria-label="${en.audience.chips.except}"`);
  });

  it("refuses an 'only' list with nobody on it, plainly, even while closed", () => {
    const nobodyLocked = people.map((p) => ({ ...p, locked: undefined }));
    for (const [locale, messages] of [["ar", ar], ["en", en]] as const) {
      const closed = picker(locale, { mode: "only", people: nobodyLocked });
      expect(summary(closed)).toBe(messages.audience.summary.nobody);
      expect(closed).toContain(messages.audience.errors.onlyEmpty);
      const open = picker(locale, { mode: "only", people: nobodyLocked, defaultOpen: true });
      expect(open).toMatch(/data-slot="combobox-chips-input"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*data-slot="combobox-chips-input"/);
    }
    // With someone on the list, no refusal.
    expect(picker("en", { mode: "only", people: nobodyLocked, selected: ["omar"] })).not.toContain(en.audience.errors.onlyEmpty);
  });

  it("tells the client admin, on the company's own item, that the firm's team still sees it", () => {
    expect(picker("en", { defaultOpen: true, owner: "client" })).toContain("team on this work still sees it. To keep a file from the firm, make it private to your company.");
    expect(picker("ar", { defaultOpen: true, owner: "client", kind: "meeting" })).toContain("يبقى فريق المكتب على هذا العمل ممن يرونه.");
    expect(picker("en", { defaultOpen: true })).not.toContain("team on this work still sees it");
  });
});

describe("the people offered, grouped", () => {
  it("lists the firm, then the client, in the server's order", () => {
    const groups = audienceGroups(people);
    expect(groups.map((g) => [g.label, g.items.map((p) => p.id)])).toEqual([
      ["firm", ["me", "omar"]],
      ["client", ["admin", "khaled", "huda"]],
    ]);
    expect(ar.audience.groups.firm).toBe("المكتب");
    expect(ar.audience.groups.client).toBe("العميل");
    expect(en.audience.groups.firm).toBe("Firm");
    expect(en.audience.groups.client).toBe("Client");
  });

  it("leaves an empty group out", () => {
    expect(audienceGroups(people.filter((p) => p.side === "client")).map((g) => g.label)).toEqual(["client"]);
  });

  it("offers only the company's own people on a client's item, under 'Your company'", () => {
    const groups = audienceGroups(people, "client");
    expect(groups.map((g) => [g.label, g.items.map((p) => p.id)])).toEqual([["yourCompany", ["admin", "khaled", "huda"]]]);
    expect(ar.audience.groups.yourCompany).toBe("شركتك");
  });
});

describe("the value to save (audienceToSave)", () => {
  const locked = ["me", "admin"];

  it("saves nothing for everyone with access, or for leaving out nobody", () => {
    expect(audienceToSave("everyone", ["omar"], locked)).toEqual({ ok: true, value: null });
    expect(audienceToSave("except", [], locked)).toEqual({ ok: true, value: null });
  });

  it("saves the people left out, never a locked one, each once", () => {
    expect(audienceToSave("except", ["omar", "me", "omar", "khaled"], locked)).toEqual({ ok: true, value: { mode: "except", people: ["omar", "khaled"] } });
    expect(audienceToSave("except", ["me", "admin"], locked)).toEqual({ ok: true, value: null });
  });

  it("puts the locked people on an 'only' list, first, and counts them", () => {
    expect(audienceToSave("only", ["khaled", "me"], locked)).toEqual({ ok: true, value: { mode: "only", people: ["me", "admin", "khaled"] } });
    // Only the people who must see it: a valid, if short, list.
    expect(audienceToSave("only", [], locked)).toEqual({ ok: true, value: { mode: "only", people: ["me", "admin"] } });
  });

  it("refuses an 'only' list with nobody on it at all", () => {
    expect(audienceToSave("only", [], [])).toEqual({ ok: false, error: "onlyEmpty" });
  });

  it("keeps locked people however the keys removed them", () => {
    // Backspace in the empty field drops the last chip, whichever it is.
    expect(audienceSelection("only", ["khaled"], locked)).toEqual(["me", "admin", "khaled"]);
    expect(audienceSelection("except", ["admin"], locked)).toEqual([]);
    expect(audienceMode("except", ["admin"], locked)).toBe("everyone");
    expect(audienceMode("except", ["omar"], locked)).toBe("except");
  });
});

describe("moving the switch (switchAudience)", () => {
  const locked = ["me"];

  it("never carries a chip across, since it means the opposite on the other side", () => {
    // Left out Omar, then "only": Omar is not suddenly one of the few who see it.
    expect(switchAudience("only", { except: ["omar"] }, locked)).toEqual({ mode: "only", selected: ["me"] });
    // Only Khaled, then "except": Khaled is not left out.
    expect(switchAudience("except", { only: ["me", "khaled"] }, locked)).toEqual({ mode: "everyone", selected: [] });
  });

  it("gives each position back what it had", () => {
    expect(switchAudience("except", { except: ["omar"], only: ["me", "khaled"] }, locked)).toEqual({ mode: "except", selected: ["omar"] });
    expect(switchAudience("only", { except: ["omar"], only: ["me", "khaled"] }, locked)).toEqual({ mode: "only", selected: ["me", "khaled"] });
  });
});

describe("when the form changes who can see the item (reconcileAudience)", () => {
  it("drops a pick who can no longer see it, and says who", () => {
    // Khaled was left out with "Shared" chosen; the label became firm-only, so the client people are gone.
    const firmOnly = people.filter((p) => p.side === "firm");
    expect(reconcileAudience("except", ["omar", "khaled"], firmOnly)).toEqual({ selected: ["omar"], dropped: ["khaled"] });
    expect(reconcileAudience("only", ["me", "khaled"], firmOnly)).toEqual({ selected: ["me"], dropped: ["khaled"] });
  });

  it("drops from a list of people left out someone who now always sees it (invited as a required attendee)", () => {
    const invited = people.map((p) => (p.id === "huda" ? { ...p, locked: "requiredAttendee" as const } : p));
    expect(reconcileAudience("except", ["huda", "khaled"], invited)).toEqual({ selected: ["khaled"], dropped: ["huda"] });
    // On an "only" list a locked person stays (they see it anyway).
    expect(reconcileAudience("only", ["huda", "khaled"], invited)).toEqual({ selected: ["huda", "khaled"], dropped: [] });
  });

  it("changes nothing when everyone picked can still be picked", () => {
    expect(reconcileAudience("except", ["omar"], people)).toEqual({ selected: ["omar"], dropped: [] });
    expect(reconcileAudience("everyone", [], people)).toEqual({ selected: [], dropped: [] });
  });

  it("names who was taken off in one plain line, in both languages", () => {
    const line = (locale: "ar" | "en") =>
      html(locale, createElement(AudienceDropped, { names: locale === "ar" ? ["خالد", "هدى"] : ["Khaled", "Huda"] }));
    expect(line("en")).toContain("Khaled");
    expect(line("en")).toContain("Huda");
    expect(line("en")).toMatch(/no longer on the list/i);
    expect(line("ar")).toContain("خالد");
    expect(line("ar")).toContain("لم يعد في القائمة");
  });
});

describe("the server's refusals, said plainly (audienceRefusal)", () => {
  const t = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "audience.errors" });
  it("maps each sentence of the database to its own message, in both languages", () => {
    const cases: [string, string][] = [
      ["that person always sees it and cannot be left out", "locked"],
      ["pick only people who can already see it", "cannotSee"],
      ["on your company's own items, choose among your company's people", "ownPeople"],
      ["someone is invited and left out of this meeting: take them off the invitations or the list", "invitedLeftOut"],
      ["that person is a required attendee: make them optional or take them off the meeting first", "requiredAttendee"],
      ["that person has an open follow-up on this meeting: give it to someone else first", "followUp"],
      ['an "only" list needs at least one person', "onlyEmpty"],
      ["this project is closed", "closed"],
      ["this file is archived", "archived"],
    ];
    for (const [message, key] of cases) {
      expect(audienceRefusal(message), message).toBe(key);
      for (const locale of ["ar", "en"] as const) expect(t(locale)(key as never), `${locale} ${key}`).not.toMatch(/^audience\./);
    }
    expect(audienceRefusal("the scanner is down")).toBeNull();
    expect(audienceRefusal(undefined)).toBeNull();
  });
});

describe("the 'Limited audience' marker", () => {
  it("says so in both languages and names nobody", () => {
    const arOut = html("ar", createElement(AudienceMarker, { kind: "document" }));
    expect(arOut).toContain("جمهور محدود");
    expect(arOut).toContain('tabindex="0"');
    expect(html("en", createElement(AudienceMarker, { kind: "meeting" }))).toContain("Limited audience");
    const hint = (locale: "ar" | "en", kind: string) =>
      createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "audience.marker" })("hint", { kind });
    expect(hint("ar", "document")).toBe("يرى هذا الملف بعضُ من لهم صلاحية فقط.");
    expect(hint("en", "meeting")).toBe("Only some of the people with access see this meeting.");
    // No placeholder for a name or a count: it cannot name the people left out.
    expect(ar.audience.marker.hint).not.toMatch(/\{(name|n|count)\b/);
    expect(en.audience.marker.hint).not.toMatch(/\{(name|n|count)\b/);
  });
});

describe("the lock reasons", () => {
  it("each has its reason in both languages", () => {
    for (const reason of AUDIENCE_LOCK_REASONS) {
      expect(ar.audience.locked[reason]).toBeTruthy();
      expect(en.audience.locked[reason]).toBeTruthy();
    }
  });
});

// "@" in the assistant's box (docs/assistant.md, "Attaching a file"), the
// screen half: when the picker opens, what picking does to the text, the
// chips and what each says when the assistant can't use a file, rendered to
// HTML with the real messages; and the pure rules the server shares
// (lib/assistant-attach.ts). The database half is tests/db/assistant-attach.test.ts.
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { AttachChips, FilePicker, type AttachedFile } from "@/components/assistant/attach";
import { Composer } from "@/components/assistant/assistant-chat";
import {
  addAttachment,
  ATTACH_PROBLEMS,
  attachStatus,
  matchFiles,
  MAX_ATTACHMENTS,
  mentionAt,
  withoutMention,
} from "@/lib/assistant-attach";

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};
const file = (over: Partial<AttachedFile> = {}): AttachedFile => ({ id: "f1", title: "Board charter review", status: "ok", ...over });

describe("when the picker opens", () => {
  it("on an @ at the start or after a space, up to the caret", () => {
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("Summarise @board ch", 19)).toEqual({ start: 10, query: "board ch" });
    expect(mentionAt("لخّص @خطة", 9)).toEqual({ start: 5, query: "خطة" });
    // The caret before the @: not in it.
    expect(mentionAt("Summarise @board", 5)).toBeNull();
  });

  it("not in an e-mail address, after a space right behind the @, or across lines", () => {
    expect(mentionAt("write to sara@acme.test", 23)).toBeNull();
    expect(mentionAt("@ board", 7)).toBeNull();
    expect(mentionAt("@board\nnext", 11)).toBeNull();
    expect(mentionAt("no at sign", 10)).toBeNull();
  });

  it("picking takes the typed @… out of the question and puts the caret where it was", () => {
    expect(withoutMention("Summarise @board ch", { start: 10, query: "board ch" })).toEqual({ text: "Summarise ", caret: 10 });
    expect(withoutMention("Compare @boa with the plan", { start: 8, query: "boa" })).toEqual({ text: "Compare with the plan", caret: 8 });
    expect(withoutMention("@x", { start: 0, query: "x" })).toEqual({ text: "", caret: 0 });
  });
});

describe("the files found", () => {
  const files = [{ title: "Board charter review" }, { title: "خطة الإدارة" }, { title: "Évaluation finale" }, { title: "Pricing memo" }];

  it("by name in either language, with the person picker's folding", () => {
    expect(matchFiles(files, "BOARD").map((f) => f.title)).toEqual(["Board charter review"]);
    expect(matchFiles(files, "خطه الاداره").map((f) => f.title)).toEqual(["خطة الإدارة"]);
    expect(matchFiles(files, "خِطَّة").map((f) => f.title)).toEqual(["خطة الإدارة"]);
    expect(matchFiles(files, "evaluation").map((f) => f.title)).toEqual(["Évaluation finale"]);
    expect(matchFiles(files, "")).toHaveLength(4);
    expect(matchFiles(files, "", 2)).toHaveLength(2);
  });

  it("each with what the assistant can do with it, from the file's own state", () => {
    expect(attachStatus({ aiIndexable: true, textStatus: "searchable" })).toBe("ok");
    expect(attachStatus({ aiIndexable: false, textStatus: "searchable" })).toBe("not_available");
    expect(attachStatus({ aiIndexable: true, textStatus: "searchable", archived: true })).toBe("not_available");
    expect(attachStatus({ aiIndexable: true, textStatus: "pending" })).toBe("not_indexed");
    expect(attachStatus({ aiIndexable: true, textStatus: "needs_ocr" })).toBe("scanned");
    expect(attachStatus({ aiIndexable: true, textStatus: "not_searchable" })).toBe("unreadable");
    // Off wins over every text state: nothing of it is read.
    for (const s of ["pending", "needs_ocr", "not_searchable"]) expect(attachStatus({ aiIndexable: false, textStatus: s })).toBe("not_available");
  });

  it("a question carries a file once, and at most three", () => {
    let list: { id: string }[] = [];
    for (const id of ["a", "b", "a", "c", "d"]) list = addAttachment(list, { id });
    expect(list.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(MAX_ATTACHMENTS).toBe(3);
  });
});

describe("the chips", () => {
  it("name each file with a button to remove it, in both languages", () => {
    const en1 = html("en", createElement(AttachChips, { files: [file()], onRemove: () => {} }));
    expect(en1).toContain("Board charter review");
    expect(en1).toContain('aria-label="Remove Board charter review"');
    expect(en1).toContain('aria-label="Files attached to your question"');
    const ar1 = html("ar", createElement(AttachChips, { files: [file()], onRemove: () => {} }));
    expect(ar1).toContain('aria-label="إزالة Board charter review"');
  });

  it("a usable file says nothing more; one the assistant can't use says why", () => {
    expect(html("en", createElement(AttachChips, { files: [file()], onRemove: () => {} }))).not.toContain("nothing from it is sent");
    const cases: [AttachedFile["status"], string, string][] = [
      ["not_available", "Not available to the assistant", "غير متاح للمساعد"],
      ["not_indexed", "Not indexed yet", "لم يُجهَّز للبحث بعد"],
      ["scanned", "Scanned pages only", "ممسوحة ضوئيًا"],
      ["unreadable", "Its text can&#x27;t be read", "غير مقروء"],
      ["draft", "never written from attached files", "لا تُكتب من الملفات المرفقة"],
      ["crowded", "work-status records filled this question", "سجلات حالة العمل"],
      ["gone", "no longer available to you", "لم يعد هذا الملف متاحًا لك"],
    ];
    expect(cases.map((c) => c[0]).sort()).toEqual([...ATTACH_PROBLEMS].sort());
    for (const [status, words, arabic] of cases) {
      expect(html("en", createElement(AttachChips, { files: [file({ status })], onRemove: () => {} })), status).toContain(words);
      expect(html("ar", createElement(AttachChips, { files: [file({ status })], onRemove: () => {} })), status).toContain(arabic);
    }
  });

  it("nothing at all when no file is attached", () => {
    expect(html("en", createElement(AttachChips, { files: [], onRemove: () => {} }))).toBe("");
  });
});

describe("the picker's list", () => {
  const props = { id: "pick", active: 1, loading: false, full: false, onPick: () => {}, onHover: () => {} };

  it("lists the files found as options, the one the arrows are on selected, with where each is and why one can't be used", () => {
    const out = html(
      "en",
      createElement(FilePicker, { ...props, results: [file(), file({ id: "f2", title: "Scanned file", status: "scanned", place: "Acme Holding · Governance" })] }),
    );
    expect(out).toContain('role="listbox"');
    expect(out.match(/role="option"/g)).toHaveLength(2);
    expect(out).toContain('id="pick-1" role="option" aria-selected="true"');
    expect(out).toContain("Acme Holding · Governance");
    expect(out).toContain("Scanned pages only");
    expect(out).toContain("Files you can attach to your question");
  });

  it("says when it is searching, when nothing matches, and when the question is full", () => {
    expect(html("en", createElement(FilePicker, { ...props, results: null, loading: true }))).toContain("Searching your files…");
    expect(html("ar", createElement(FilePicker, { ...props, results: [] }))).toContain("لا يوجد ملف متاح لك بهذا الاسم.");
    const full = html("en", createElement(FilePicker, { ...props, results: [file()], full: true }));
    expect(full).toContain("at most three files");
    expect(full).not.toContain('role="option"');
  });
});

describe("the box", () => {
  it("tells the person they can type @, in both languages, and draws no list or chip until they do", () => {
    const props = { onAsk: async () => true, busy: false, disabled: false, projectId: "p1" };
    const en1 = html("en", createElement(Composer, props));
    expect(en1).toContain("Type @ to attach a file you can see");
    expect(en1).not.toContain('role="listbox"');
    expect(en1).not.toContain("Files attached to your question");
    expect(html("ar", createElement(Composer, props))).toContain("اكتب @ لإرفاق ملف تراه");
  });
});

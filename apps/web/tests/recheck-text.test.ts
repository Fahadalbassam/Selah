// Screen texts from the re-check of the screens batch 0 changed (page audit
// section 8, fault 3), checked against the real message catalogues, Arabic
// first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

type Messages = typeof ar;
const tr = (locale: "ar" | "en", namespace: string) =>
  createTranslator({ locale, messages: (locale === "ar" ? ar : en) as Messages, namespace: namespace as never }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;

/** Every string of a catalogue with its key. */
function flat(o: object, path = "", out: [string, string][] = []): [string, string][] {
  for (const [k, v] of Object.entries(o)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "string") out.push([p, v]);
    else flat(v as object, p, out);
  }
  return out;
}
const get = (m: object, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m) as string;

describe("releasing a draft action: one Arabic verb everywhere", () => {
  // The draft line said «حتى تُصدره», the button «إسناد إلى المسؤول», the add dialog «إرساله إلى المسؤول الآن».
  const keys = [
    "action.move.assigned",
    "action.draftNotice",
    "action.draftNoticeReader",
    "action.errors.ownerGone",
    "action.errors.replacementDraft",
    "action.secondReview.revisions",
    "plan.action.addHint",
    "plan.action.noOwners",
    "plan.action.release",
    "plan.action.releaseHint",
    "plan.action.released",
    "plan.errors.releaseNeeds",
    "planImport.review.released",
    "planImport.review.release",
    "planImport.review.releaseHint",
    "planImport.review.createsRelease",
    "planImport.issues.staysDraft",
    "importExport.guide.fields.dueDate",
    "insight.deviations.rules.slipped.hint",
  ];

  it("is «إسناد» (the button's word) in every Arabic line about it, and «release» in English", () => {
    for (const key of keys) {
      const a = get(ar, key);
      expect(a, key).toMatch(/إسناد|أُسند|يُسند|تُسند|أسنِد/);
      expect(a, key).not.toMatch(/إصدار|أصدر|يُصدر|تُصدر|إرساله|يرسله|يرسلها|تُرسل إلى المسؤول|يُرسل إلى المسؤول|إرسال الإجراءات|ليُرسل|قبل الإرسال/);
      expect(get(en, key), key).toMatch(/[Rr]eleas/);
    }
  });

  it("says «released actions» with the same word on the progress figures and reports", () => {
    for (const key of ["metrics.noneYet", "metrics.historyHint", "reportPdf.noneYet", "clientProgress.pdf.noneYet"]) {
      expect(get(ar, key), key).toContain("مُسندة");
      expect(get(ar, key), key).not.toMatch(/المعتمدة|مُطلقة/);
    }
  });

  it("tells someone who cannot release it (an observer) when the client sees it, without 'you release'", () => {
    expect(en.action.draftNotice).toMatch(/until you release it/);
    expect(en.action.draftNoticeReader).toMatch(/until it is released/);
    expect(en.action.draftNoticeReader).not.toMatch(/\byou\b/i);
    // Arabic needs no "you" for either: «قبل إسناده» fits the reader and the person who releases it, man or woman.
    expect(ar.action.draftNoticeReader).not.toMatch(/تُسنده|تُصدره/);
  });
});

describe("a status change in the activity record reads from, then to", () => {
  it("in Arabic: «من «قيد التنفيذ» إلى «مغلق»», never «إلى … بعد …»", () => {
    const values = { from: "قيد التنفيذ", to: "مغلق" };
    expect(tr("ar", "project")("changed", values)).toBe("تغيير الحالة من «قيد التنفيذ» إلى «مغلق»");
    expect(tr("ar", "inbox.events")("status_changed", values)).toBe("نقل الطلب من «قيد التنفيذ» إلى «مغلق»");
    expect(tr("ar", "action.entry")("moved", values)).toBe("نقل الإجراء من قيد التنفيذ إلى مغلق");
    expect(tr("en", "project")("changed", values)).toBe("moved قيد التنفيذ to مغلق");
  });
});

describe("the Progress tab's note says what is true since departments limit readers (D8)", () => {
  it("no longer says the client's admins and managers see the same numbers", () => {
    expect(ar.metrics.hint).not.toMatch(/الأرقام نفسها|مديرو العميل/);
    expect(en.metrics.hint).not.toMatch(/same numbers|client's admins/);
    expect(ar.metrics.hint).toContain("يرى كل شخص أرقام العمل الذي يحق له الاطلاع عليه");
    expect(en.metrics.hint).toContain("Each person sees the figures for the work they may see");
  });
});

describe("the invite warnings on the meeting form and the add-attendee form", () => {
  const keys = ["leftOut", "leftOutNoOffer", "leftOutNoDepartment", "leftOutKeepsDepartment", "departmentOnlyHint"];

  it("use no verb or pronoun that fits only a man for the person named (Reem, Sara)", () => {
    for (const key of keys) {
      const a = get(ar.meeting.form, key);
      // «لن يتمكن {names}», «لإشراكه», «إضافته», «لكنه», «تحجز» (you, masculine) were the old forms.
      expect(a, key).not.toMatch(/يتمكن|لن يتمكنوا|لإشراكه|لإشراكهم|إضافته|إضافتهم|لكنه|استبعده|استبعدهم|يشمله|يشملهم|لإدارته|لإدارتهم|ينتمي|ينتمون|تحجز /);
    }
    const out = tr("ar", "meeting.form")("leftOut", { names: "ريم الحربي", n: 1 });
    expect(out).toContain("لا يُفتح هذا الاجتماع لـريم الحربي");
  });

  it("say plainly that the calendar invitation still goes out to the person, without the agenda", () => {
    const a = tr("ar", "meeting.form")("leftOut", { names: "ريم الحربي", n: 1 });
    expect(a).toContain("تصل دعوة التقويم إلى ريم الحربي");
    expect(a).toContain("دون جدول الأعمال");
    const e = tr("en", "meeting.form")("leftOut", { names: "Reem", n: 1 });
    expect(e).toMatch(/still get the calendar invitation/);
    expect(e).toMatch(/not the agenda/);
  });
});

describe("a tab with nothing this reader may open (fault 4)", () => {
  // A manager limited to her department, or an action owner, read «لا توجد اجتماعات بعد» while the project
  // had meetings she was not shown, and «لم تطلب الشركة أي شيء بعد» while it had requests. The line must be
  // true for her without saying that anything is hidden: "none for you yet", no count, no "other".
  const forYou = [
    ["project.noMeetings", "لا اجتماعات لك بعد.", "No meetings for you yet."],
    ["project.noDocs", "لا مستندات لك بعد.", "No documents for you yet."],
    ["project.noRecsClient", "لا توصيات لك بعد.", "No recommendations for you yet."],
    ["infoRequests.emptyClient", "لا طلبات لك بعد.", "No requests for you yet."],
    ["recommendationPage.noActionsClient", "لا إجراءات لك بعد.", "No actions for you yet."],
  ] as const;

  it("says there is none for you yet, in both languages, and nothing about what is hidden", () => {
    for (const [key, a, e] of forYou) {
      expect(get(ar, key), key).toBe(a);
      expect(get(en, key), key).toBe(e);
    }
  });

  it("the client's side of the plan and of a recommendation gets that line; the firm, which sees all of them, keeps its own", () => {
    const project = readFileSync(join(__dirname, "../src/app/(app)/projects/[id]/page.tsx"), "utf8");
    expect(project).toContain(`description={t(firmStaff ? "noRecs" : "noRecsClient")}`);
    const rec = readFileSync(join(__dirname, "../src/app/(app)/recommendations/[id]/page.tsx"), "utf8");
    expect(rec).toContain(`t(data.firmStaff ? "noActions" : "noActionsClient")`);
    expect(en.project.noRecs).toBe("No recommendations yet.");
    expect(en.recommendationPage.noActions).toBe("No actions yet.");
  });
});

describe("the line under a client's figures speaks to the client about its own company (fault 5)", () => {
  // Decided (the lead, 18 Nov 2026): the client reads «أرقام شركتكم كما أُبلغ عنها، وليست أثرًا موثّقًا» /
  // "Your company's reported figures, not verified impact"; the firm keeps "reported by the client".
  it("has the decided words for client readers and keeps the firm's", () => {
    for (const ns of ["indicators", "indicatorData"] as const) {
      expect(ar[ns].claimNoteClient, ns).toMatch(/^أرقام شركتكم كما أُبلغ عنها، وليست أثرًا موثّقًا/);
      expect(en[ns].claimNoteClient, ns).toMatch(/^Your company's reported figures, not verified impact\./);
      expect(ar[ns].claimNoteClient, ns).not.toContain("العميل");
      expect(en[ns].claimNoteClient, ns).not.toContain("client");
      // Neither claims the change came from a recommendation.
      expect(en[ns].claimNoteClient, ns).toMatch(/not proof that a recommendation caused it/);
    }
    expect(ar.indicators.claimNote).toContain("يبلّغ عنها العميل");
    expect(en.indicators.claimNote).toContain("reported by the client");
  });

  it("is chosen by who reads it on every screen that shows it", () => {
    const screens = [
      "src/app/(app)/indicators/[id]/page.tsx",
      "src/app/(app)/indicators/data/page.tsx",
      "src/app/(app)/indicators/import/import-wizard.tsx",
      "src/app/(app)/reports/[id]/status-pack.tsx",
      "src/components/indicators/indicators-card.tsx",
      "src/components/indicators/linked-indicators-card.tsx",
    ];
    for (const f of screens) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      // No screen draws the firm's line to everyone any more...
      expect(src, f).not.toMatch(/\b\w+\("claimNote"\)/);
      // ...each picks the client's line for a client reader.
      expect(src, f).toMatch(/\? "claimNote" : "claimNoteClient"/);
    }
  });
});

describe("the firm admin's role label", () => {
  it("is «مدير المكتب», as everywhere else", () => {
    expect(ar.role.firm_admin).toBe("مدير المكتب");
    expect(tr("ar", "account.invite")("subtitle", { role: ar.role.firm_admin })).toBe("دُعيت بصفة مدير المكتب.");
    // (The Help page's "first steps", which also named the role, went in batch 1, page audit U17.)
  });

  it("and no screen calls the firm's admins «مدير الشركة», «مسؤولو الشركة» or «مسؤول في المكتب»", () => {
    // The versioned legal texts are left as accepted (their wording changes only with a new version).
    const lines = flat(ar).filter(([k]) => !k.startsWith("legal."));
    expect(lines.filter(([, v]) => /مدير الشركة|مديري الشركة|مديرو الشركة|مسؤولو الشركة|مسؤول في المكتب|مسؤولي المكتب|مسؤولو المكتب|مسؤول المكتب/.test(v))).toEqual([]);
  });
});

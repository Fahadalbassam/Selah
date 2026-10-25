// Synthetic files for the walkthrough (fictional companies and people, never
// real client data). Word files are built here so they open in Word and the
// assistant can read them; .txt files stand in for scanned minutes.
import { writeZip } from "@/lib/office/zip";
import { xmlEscape } from "@/lib/office/xml";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A minimal Word document: one paragraph per line, right to left when the line is Arabic. */
export function docx(lines: string[]): Uint8Array {
  const arabic = /[؀-ۿ]/;
  const paragraph = (line: string) => {
    const rtl = arabic.test(line);
    return `<w:p><w:pPr>${rtl ? "<w:bidi/><w:jc w:val=\"right\"/>" : ""}</w:pPr><w:r><w:rPr>${rtl ? "<w:rtl/>" : ""}</w:rPr><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`;
  };
  return writeZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(paragraph).join("")}</w:body></w:document>`,
  });
}

export interface SeedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export const word = (name: string, lines: string[]): SeedFile => ({ name, type: DOCX_MIME, bytes: docx(lines) });
export const text = (name: string, body: string): SeedFile => ({ name, type: "text/plain", bytes: new TextEncoder().encode(body) });

// ---------------------------------------------------------------- Al-Nukhba

/** Files the firm shares on the board governance project; the assistant answers from these. */
export const nukhbaLibrary = {
  assessment: word("تقرير تقييم الحوكمة 2026.docx", [
    "شركة النخبة القابضة — تقرير تقييم الحوكمة المبدئي (أبريل 2026)",
    "أعدته ميزان للاستشارات بناءً على المقابلات ومراجعة الوثائق.",
    "الملاحظة 1: لا يوجد ميثاق مكتوب لمجلس الإدارة يحدد صلاحياته ومسؤولياته وآلية تقييمه.",
    "الملاحظة 2: لا توجد لجنة مراجعة مستقلة، ويقوم المدير المالي بمتابعة المراجع الخارجي مباشرة.",
    "الملاحظة 3: مصفوفة تفويض الصلاحيات الحالية (2024) تسمح للرئيس التنفيذي باعتماد نفقات حتى مليون ريال دون الرجوع للمجلس.",
    "الملاحظة 4: سياسة تعارض المصالح معتمدة لكن لا يوجد سجل محدث لإفصاحات الأعضاء.",
    "التوصيات: اعتماد ميثاق المجلس، تشكيل لجنة مراجعة بأغلبية مستقلة، تحديث مصفوفة الصلاحيات، وتفعيل سجل الإفصاحات السنوي.",
  ]),
  coi: word("سياسة تعارض المصالح GOV-POL-07.docx", [
    "شركة النخبة القابضة — سياسة تعارض المصالح (رمز السياسة GOV-POL-07)، الإصدار 2.0",
    "المادة 12: يجب على كل عضو في مجلس الإدارة الإفصاح كتابياً عن أي مصلحة مباشرة أو غير مباشرة في الأعمال والعقود التي تتم لحساب الشركة، وذلك خلال خمسة عشر يوماً من علمه بها.",
    "المادة 13: يمتنع العضو صاحب المصلحة عن التصويت على القرار المتعلق بها.",
    "المادة 18: يراجع أمين سر المجلس سجل الإفصاحات سنوياً ويرفعه إلى لجنة المراجعة.",
    "اعتمدت هذه السياسة في اجتماع المجلس رقم 12 بتاريخ 2025-11-20.",
  ]),
  doaOld: word("Delegation of authority matrix 2024.docx", [
    "Al-Nukhba Holding — Delegation of Authority Matrix, version 1 (approved January 2024).",
    "The CEO may approve capital expenditure up to SAR 1,000,000 without board approval.",
    "Procurement contracts above SAR 1,000,000 require board approval.",
    "The CFO may approve payments up to SAR 250,000.",
  ]),
  doaNew: word("مصفوفة الصلاحيات 2026 (مسودة).docx", [
    "شركة النخبة القابضة — مصفوفة تفويض الصلاحيات، الإصدار 2 (مسودة، مارس 2026، لم تعتمد بعد).",
    "يجوز للرئيس التنفيذي اعتماد النفقات الرأسمالية حتى 750,000 ريال دون الرجوع إلى مجلس الإدارة.",
    "تتطلب عقود المشتريات التي تتجاوز 750,000 ريال موافقة المجلس.",
    "يجوز للمدير المالي اعتماد المدفوعات حتى 200,000 ريال.",
  ]),
  minutes: text(
    "Board minutes 2026-03-02.txt",
    `Al-Nukhba Holding — Minutes of the Board of Directors, meeting no. 14, 2 March 2026, Riyadh.
Present: Fahd Al-Dosari (chair), Mansour Al-Anazi (CEO), Reem Al-Harbi (board secretary), Khalid Al-Shammari (Mizan Advisory, observer).

Item 1. Audit committee. The board resolved to form an audit committee of three members, at least two of them independent. The committee will be chaired by an independent member. Reem Al-Harbi will circulate the draft committee charter.
Item 2. Related-party transactions. The board asked management to list all related-party contracts above SAR 500,000 for the next meeting.
Item 3. Board charter. The board asked Mizan Advisory to help draft a board charter for approval before the end of the year.
Decision log: R-14/1 audit committee formed; R-14/2 related-party list requested; R-14/3 board charter to be drafted.`,
  ),
};

/** The consultant's own working notes: firm-only, never shown to the client or the client assistant. */
export const nukhbaPrivateNotes = word("ملاحظات المستشار الداخلية.docx", [
  "ملاحظات داخلية — لا تشارك مع العميل.",
  "درجة نضج الحوكمة المبدئية للنخبة: 2.1 من 5.",
  "المدير المالي متحفظ على تشكيل لجنة المراجعة ويؤخر الترشيحات.",
  "اقتراح: نطلب من رئيس المجلس التدخل قبل نهاية الربع.",
]);

/** Evidence the client sends on actions. */
export const nukhbaEvidence = {
  charterDraft: word("مسودة ميثاق مجلس الإدارة v3.docx", [
    "ميثاق مجلس إدارة شركة النخبة القابضة — المسودة الثالثة",
    "الفصل الأول: تكوين المجلس — يتكون المجلس من سبعة أعضاء، ثلاثة منهم على الأقل مستقلون.",
    "الفصل الثاني: صلاحيات المجلس — اعتماد الاستراتيجية والميزانية وسياسات المخاطر وتعيين الرئيس التنفيذي.",
    "الفصل الثالث: اجتماعات المجلس — أربعة اجتماعات على الأقل في السنة، والنصاب حضور أغلبية الأعضاء.",
    "الفصل الرابع: تقييم المجلس — تقييم سنوي لأداء المجلس ولجانه وأعضائه.",
  ]),
  boardPresentation: word("محضر عرض الميثاق على المجلس.docx", [
    "محضر اجتماع مجلس الإدارة رقم 16 — بند عرض مسودة الميثاق",
    "عرضت أمينة سر المجلس المسودة الثالثة من الميثاق، وناقش الأعضاء فصل التقييم السنوي.",
    "قرر المجلس اعتماد الميثاق مع تعديل نصاب الاجتماعات، على أن تنشر النسخة النهائية خلال شهر.",
  ]),
  committeeBylaws: word("مسودة لائحة لجنة المراجعة.docx", [
    "لائحة عمل لجنة المراجعة — مسودة أولى",
    "تتكون اللجنة من ثلاثة أعضاء يعينهم مجلس الإدارة.",
    "ترفع اللجنة تقريرها إلى المجلس.",
  ]),
  disclosures: text(
    "سجل إفصاحات الأعضاء 2026.txt",
    `سجل إفصاحات أعضاء مجلس الإدارة عن تعارض المصالح — 2026
وصلت إفصاحات خمسة أعضاء من سبعة.
لم يصل إفصاح عضوين بسبب سفرهما، وسيستكملان عند عودتهما.`,
  ),
  doaLimits: word("مراجعة حدود الصلاحيات المالية.docx", [
    "مراجعة حدود الصلاحيات المالية — الإدارة المالية",
    "قارنا الحدود الحالية بممارسات الشركات المماثلة في السوق السعودي.",
    "المقترح: خفض حد الرئيس التنفيذي إلى 750,000 ريال، وحد المدير المالي إلى 200,000 ريال.",
  ]),
};

// ---------------------------------------------------------------- Rawdah

export const rawdahLibrary = {
  plan: word("Rawdah strategic plan 2027 (final).docx", [
    "Rawdah Foundation — Strategic Plan 2027, final version approved by the board of trustees.",
    "Goal 1: award 40 university scholarships to orphans in Jeddah and Taif by December 2027.",
    "Goal 2: raise the share of income from endowment (waqf) returns to 35%.",
    "Goal 3: publish an annual impact report for donors every June.",
    "Each goal has an owner on the executive team and a quarterly review by the board.",
  ]),
};

export const rawdahEvidence = {
  kpis: word("Rawdah KPI cards.docx", [
    "Rawdah Foundation — KPI cards for the 2027 plan",
    "Scholarships awarded (count, quarterly), endowment income share (%, yearly), donor retention (%, yearly).",
  ]),
  approval: text("Board of trustees approval.txt", "The board of trustees approved the Strategic Plan 2027 in its meeting of 14 September 2026 (resolution BT-2026-09)."),
  roadmap: word("Implementation roadmap 2027.docx", ["Rawdah Foundation — implementation roadmap by quarter, with owners and budget lines."]),
};

// ---------------------------------------------------------------- Al-Waha

export const wahaEvidence = {
  charter: word("مسودة ميثاق العائلة.docx", [
    "مكتب الواحة العائلي — مسودة ميثاق العائلة",
    "يتكون مجلس العائلة من سبعة أعضاء يمثلون الفروع الثلاثة.",
    "لا يجوز بيع أي حصة لغير أفراد العائلة إلا بموافقة ثلثي مجلس العائلة.",
  ]),
};

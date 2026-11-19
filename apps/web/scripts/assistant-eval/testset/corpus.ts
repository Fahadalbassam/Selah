// The labelled test set's files (section 7 item 7). Synthetic only: fictional
// companies, people, vendors and figures, written for this set. Never real
// client data, and no text from any published work.
//
// Every file is a list of passages, each with a stable id. A passage is one
// paragraph on one line, at most PASSAGE_MAX characters, so the indexer
// (src/jobs/index-documents.ts, passages() splits at blank lines and packs up
// to 1,200 characters) never cuts one: a search result "covers" a passage when
// its text contains the passage's text. Questions mark the right passages by
// these ids (questions.ts), so retrieval and citations are scored without a model.

export type Lang = "ar" | "en" | "mixed";
export type ProjectKey = "board" | "waha" | "rawdah";

export interface Passage {
  id: string;
  text: string;
}

export interface CorpusFile {
  key: string;
  project: ProjectKey;
  title: string;
  lang: Lang;
  /** Who uploads it: the project's consultant. */
  by: "khalid" | "noura";
  visibility: "shared" | "firm_private";
  /** "scanned-pdf": a PDF whose first page has text and the last page is only an image (no text layer). */
  kind: "text" | "scanned-pdf";
  /** Pages of passages; a new page is a form feed in the text file. */
  pages: Passage[][];
  /** Scanned-pdf only: what the image page shows, never in any text layer (questions about it must not be answerable). */
  imageOnly?: string;
}

export const PASSAGE_MAX = 1150;

// ------------------------------------------------------------------ helpers

/** Neutral clauses that make a long document long without adding facts. */
const FILL_EN = [
  "This clause is read together with the definitions in the first part of this document.",
  "Where this document is silent, the company's articles of association and the applicable regulations apply.",
  "Any change to this clause follows the approval route set out in the final part of this document.",
  "Each member confirms in writing, on taking office, that they have read and understood this clause.",
  "The clause applies equally to executive, non-executive and independent members.",
  "Records made under this clause are kept by the secretary in the company's archive.",
  "Headings are for convenience only and do not change the meaning of the text.",
  "If a provision of this clause conflicts with a mandatory rule, the mandatory rule prevails and the rest of the clause stands.",
  "References to a person include anyone acting in that role on an interim basis.",
  "The secretary may issue a short guidance note on how this clause is applied, which does not change its content.",
  "A question about the meaning of this clause is put to the chair, whose reading is recorded in the minutes.",
  "Nothing in this clause limits the duties that members owe to the company under the law.",
];
const FILL_AR = [
  "يُقرأ هذا البند مع التعريفات الواردة في الجزء الأول من هذه الوثيقة.",
  "وفيما لم يرد فيه نص في هذه الوثيقة يُرجع إلى النظام الأساس للشركة والأنظمة المعمول بها.",
  "ويخضع أي تعديل على هذا البند لمسار الاعتماد المبين في الجزء الأخير من هذه الوثيقة.",
  "ويقر كل عضو كتابةً عند توليه منصبه بأنه اطلع على هذا البند وفهم مضمونه.",
  "ويسري هذا البند على الأعضاء التنفيذيين وغير التنفيذيين والمستقلين على حد سواء.",
  "ويحتفظ أمين السر بالسجلات التي تُعد بموجب هذا البند في أرشيف الشركة.",
  "والعناوين الواردة للتيسير فقط ولا تغير من معنى النص.",
  "وإذا تعارض حكم من أحكام هذا البند مع قاعدة نظامية آمرة طُبقت القاعدة الآمرة وبقي سائر البند نافذاً.",
  "وتشمل الإشارة إلى أي شخص من يشغل الدور ذاته بصفة مؤقتة.",
  "ويجوز لأمين السر إصدار مذكرة إرشادية موجزة عن كيفية تطبيق هذا البند دون أن تغير مضمونه.",
  "ويُعرض أي خلاف في تفسير هذا البند على رئيس المجلس ويُثبت تفسيره في المحضر.",
  "ولا يحد هذا البند من الواجبات المقررة نظاماً على الأعضاء تجاه الشركة.",
];

/** A long clause: its own sentences, then neutral clauses until it is about 1,000 to 1,150 characters. */
function clause(id: string, text: string, lang: "ar" | "en", seed: number): Passage {
  const pool = lang === "ar" ? FILL_AR : FILL_EN;
  let out = text;
  for (let i = 0; out.length < 1000; i++) {
    const next = `${out} ${pool[(seed + i * 5) % pool.length]}`;
    if (next.length > PASSAGE_MAX) break;
    out = next;
  }
  return { id, text: out };
}

const p = (id: string, text: string): Passage => ({ id, text });
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const pad = (n: number) => String(n).padStart(2, "0");

// ------------------------------------------------- Al-Nukhba Holding (board)

const NUKHBA: CorpusFile[] = [
  {
    key: "N.min14", project: "board", title: "Board minutes 2026-03-02.txt", lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.min14.head", "Al-Nukhba Holding. Minutes of the Board of Directors, meeting no. 14, 2 March 2026, Riyadh. Present: Fahd Al-Dosari (chair), Reem Al-Harbi (secretary), Abdullah Al-Mutairi, and Khalid Al-Shammari of Mizan Advisory as observer."),
      p("N.min14.audit", "Item 1, audit committee. The board resolved to form an audit committee of three members, at least two of them independent. The committee will be chaired by an independent member to be nominated by 30 April 2026. Reem Al-Harbi will circulate the draft committee charter."),
    ], [
      p("N.min14.rp", "Item 2, related-party transactions. The board asked management to list all related-party contracts above SAR 500,000 for the next meeting. Decision R-14/2."),
      p("N.min14.aud", "Item 3, external auditor. The board noted that the external auditor asked for the 2025 inventory count sheets before the year-end fieldwork. Decision log: R-14/1 audit committee formed; R-14/2 related-party list requested."),
    ]],
  },
  {
    key: "N.coi", project: "board", title: "سياسة تعارض المصالح GOV-POL-07.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.coi.head", "شركة النخبة القابضة. سياسة تعارض المصالح (رمز السياسة GOV-POL-07)، الإصدار 2.0، اعتمدت في اجتماع المجلس رقم 12 بتاريخ 2025-11-20."),
      p("N.coi.a12", "المادة 12: يجب على كل عضو في مجلس الإدارة الإفصاح كتابياً عن أي مصلحة مباشرة أو غير مباشرة في الأعمال والعقود التي تتم لحساب الشركة، وذلك خلال خمسة عشر يوماً من علمه بها."),
      p("N.coi.a13", "المادة 13: يمتنع العضو صاحب المصلحة عن التصويت على القرار المتعلق بها، ولا يُحتسب في النصاب عند التصويت عليه."),
    ], [
      p("N.coi.a18", "المادة 18: يراجع أمين سر المجلس سجل الإفصاحات سنوياً ويرفعه إلى لجنة المراجعة مع ملاحظاته."),
    ]],
  },
  {
    key: "N.rem.v1", project: "board", title: "سياسة مكافآت أعضاء المجلس - الإصدار 1.0.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.rem.v1.head", "شركة النخبة القابضة. سياسة مكافآت أعضاء مجلس الإدارة واللجان، الإصدار 1.0، اعتمدتها الجمعية العامة في 2023-04-18."),
      p("N.rem.v1.cap", "البند 4: لا يتجاوز مجموع ما يحصل عليه عضو مجلس الإدارة من مكافآت سنوية مبلغ 300,000 ريال."),
      p("N.rem.v1.allow", "البند 5: يُصرف لعضو المجلس بدل حضور قدره 3,000 ريال عن كل جلسة من جلسات المجلس أو لجانه."),
    ]],
  },
  {
    key: "N.rem.v2", project: "board", title: "سياسة مكافآت أعضاء المجلس - الإصدار 2.0.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.rem.v2.status", "شركة النخبة القابضة. سياسة مكافآت أعضاء مجلس الإدارة واللجان، الإصدار 2.0، اعتمدتها الجمعية العامة في 2026-05-10، ويحل هذا الإصدار محل الإصدار 1.0 ويلغيه من تاريخ اعتماده."),
      p("N.rem.v2.cap", "البند 4: لا يتجاوز مجموع ما يحصل عليه عضو مجلس الإدارة من مكافآت سنوية مبلغ 500,000 ريال، على أن يرتبط نصفها بحضور الاجتماعات."),
      p("N.rem.v2.allow", "البند 5: يُصرف لعضو المجلس بدل حضور قدره 5,000 ريال عن كل جلسة من جلسات المجلس، و4,000 ريال عن كل جلسة من جلسات اللجان."),
    ]],
  },
  {
    key: "N.doa.2024", project: "board", title: "Delegation of authority matrix 2024.txt", lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.doa.2024.head", "Al-Nukhba Holding. Delegation of Authority Matrix, version 1, approved by the board in January 2024."),
      p("N.doa.2024.capex", "The CEO may approve capital expenditure up to SAR 1,000,000 without board approval. Procurement contracts above SAR 1,000,000 require board approval."),
    ]],
  },
  {
    key: "N.doa.2026", project: "board", title: "مصفوفة الصلاحيات 2026.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.doa.2026.capex", "شركة النخبة القابضة. مصفوفة تفويض الصلاحيات، الإصدار 2 (مسودة، مارس 2026، لم تعتمد بعد). يجوز للرئيس التنفيذي اعتماد النفقات الرأسمالية حتى 750,000 ريال دون الرجوع إلى مجلس الإدارة، وتتطلب عقود المشتريات التي تتجاوز 750,000 ريال موافقة المجلس."),
    ]],
  },
  {
    // Long (about 14 passages of 1,000+ characters): its eight best passages pass 4,000 tokens.
    key: "N.charter", project: "board", title: "لائحة عمل مجلس الإدارة 2026.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      clause("N.charter.c1", "لائحة عمل مجلس إدارة شركة النخبة القابضة لعام 2026. البند 1، الغرض: تنظم هذه اللائحة تكوين مجلس الإدارة واختصاصاته وطريقة عمله وعلاقته بالإدارة التنفيذية.", "ar", 0),
      clause("N.charter.comp", "البند 2، التكوين: يتكون مجلس الإدارة من تسعة أعضاء تنتخبهم الجمعية العامة لمدة ثلاث سنوات، على ألا يقل عدد الأعضاء المستقلين عن ثلاثة أعضاء، وأن تكون أغلبية الأعضاء من غير التنفيذيين.", "ar", 1),
      clause("N.charter.chair", "البند 3، رئيس المجلس: ينتخب المجلس رئيسه ونائبه من بين أعضائه غير التنفيذيين، ولا يجوز الجمع بين منصب رئيس المجلس ومنصب الرئيس التنفيذي أو أي منصب تنفيذي آخر في الشركة.", "ar", 2),
      clause("N.charter.meet", "البند 4، الاجتماعات: يعقد المجلس أربعة اجتماعات على الأقل في السنة المالية، بمعدل اجتماع واحد في كل ربع سنة، ويجوز عقد اجتماعات إضافية بدعوة من الرئيس أو بطلب عضوين.", "ar", 3),
      clause("N.charter.quorum", "البند 5، النصاب: لا يكون اجتماع المجلس صحيحاً إلا بحضور نصف الأعضاء على الأقل، على أن يكون من بينهم الرئيس أو نائبه.", "ar", 4),
      clause("N.charter.vote", "البند 6، القرارات: تصدر قرارات المجلس بأغلبية أصوات الأعضاء الحاضرين، وعند تساوي الأصوات يرجح الجانب الذي صوت معه رئيس الجلسة.", "ar", 5),
      clause("N.charter.agenda", "البند 7، جدول الأعمال: يُرسل جدول الأعمال والمستندات المتعلقة به إلى الأعضاء قبل سبعة أيام على الأقل من موعد الاجتماع، إلا في الحالات العاجلة التي يقدرها الرئيس.", "ar", 6),
    ], [
      clause("N.charter.sec", "البند 8، أمين السر: يعين المجلس أمين سر من غير أعضائه يتولى إعداد المحاضر وحفظها وتبليغ القرارات ومتابعة تنفيذها.", "ar", 7),
      clause("N.charter.comm", "البند 9، اللجان: يشكل المجلس ثلاث لجان دائمة هي لجنة المراجعة ولجنة الترشيحات والمكافآت ولجنة المخاطر، ويحدد لكل منها ميثاقاً يعتمده المجلس.", "ar", 8),
      clause("N.charter.induct", "البند 10، التهيئة والتدريب: يحصل كل عضو جديد على برنامج تهيئة خلال ستين يوماً من تعيينه، يشمل استراتيجية الشركة ووضعها المالي وأهم المخاطر.", "ar", 9),
      clause("N.charter.eval", "البند 11، التقييم: يجري المجلس تقييماً ذاتياً سنوياً لأدائه وأداء لجانه وأعضائه، ويستعين بجهة خارجية مستقلة لإجراء التقييم مرة كل ثلاث سنوات.", "ar", 10),
      clause("N.charter.conf", "البند 12، السرية: يلتزم الأعضاء بالمحافظة على سرية المعلومات التي يطلعون عليها بحكم عضويتهم، ويستمر هذا الالتزام بعد انتهاء العضوية.", "ar", 11),
      clause("N.charter.rp", "البند 13، تعارض المصالح: تخضع تعاملات الأعضاء مع الشركة لسياسة تعارض المصالح ذات الرمز GOV-POL-07.", "ar", 0),
      clause("N.charter.amend", "البند 14، المراجعة والتعديل: تُراجع هذه اللائحة كل سنتين، ويُعرض أي تعديل عليها على الجمعية العامة لاعتماده.", "ar", 3),
    ]],
  },
  {
    key: "N.acharter", project: "board", title: "Audit committee charter (draft for approval).txt", lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      clause("N.acharter.purpose", "Al-Nukhba Holding, audit committee charter, draft for approval. Clause 1, purpose: the committee helps the board oversee financial reporting, internal control, internal audit and the external audit.", "en", 0),
      clause("N.acharter.member", "Clause 2, membership: the committee has three to five members, the majority of them independent, and at least one member with recognised accounting or finance expertise. The committee chair must be an independent member and may not chair the board.", "en", 1),
      clause("N.acharter.meet", "Clause 3, meetings: the committee meets at least six times a year, and in any case before the board approves the quarterly and annual financial statements.", "en", 2),
      clause("N.acharter.quorum", "Clause 4, quorum: a meeting is valid when two members are present, one of them independent.", "en", 3),
      clause("N.acharter.ext", "Clause 5, external auditor: the committee recommends the appointment, fees and removal of the external auditor, and the lead audit partner rotates at least every five years.", "en", 4),
      clause("N.acharter.ia", "Clause 6, internal audit: the head of internal audit reports functionally to the committee and administratively to the CEO. The committee approves the annual internal audit plan.", "en", 5),
    ], [
      clause("N.acharter.whistle", "Clause 7, whistleblowing: the committee oversees the whistleblowing policy GOV-POL-11 and receives a summary of reports every quarter.", "en", 6),
      clause("N.acharter.report", "Clause 8, reporting: the committee chair reports to the board after each meeting, and the committee submits an annual report to the general assembly.", "en", 7),
      clause("N.acharter.private", "Clause 9, private sessions: at least once a year the committee meets the external auditor without management present.", "en", 8),
      clause("N.acharter.review", "Clause 10, review: the committee reviews this charter every year and proposes changes to the board.", "en", 9),
      clause("N.acharter.advisers", "Clause 11, resources: the committee may engage independent advisers at the company's expense when it needs specialist advice.", "en", 10),
    ]],
  },
  {
    key: "N.scan", project: "board", title: "Related-party register (signed, scanned).pdf", lang: "en", by: "khalid", visibility: "shared", kind: "scanned-pdf",
    pages: [[
      p("N.scan.p1", "Cover letter. Please find attached on page 2 the signed related-party register as at 31 March 2026, scanned from the original kept by the board secretary."),
    ]],
    imageOnly: "The register itself (names of related parties and contract values) is only on page 2, an image with no text layer.",
  },
  {
    key: "N.workshop", project: "board", title: "Board evaluation workshop - ورشة تقييم المجلس.txt", lang: "mixed", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.workshop.head", "Board evaluation workshop, 14 September 2026. ورشة تقييم المجلس، بحضور ثمانية أعضاء."),
      p("N.workshop.out", "Outcomes / النتائج: اتفق الأعضاء على ثلاث نقاط تحسين: تقديم مستندات الاجتماع مبكراً، وتخصيص وقت أطول للاستراتيجية، وتحسين متابعة القرارات. Owner: board secretary, by 31 December 2026."),
    ]],
  },
  {
    key: "N.ia", project: "board", title: "Internal audit report Q2 2026.txt", lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.ia.head", "Al-Nukhba Holding. Internal audit report, second quarter 2026, presented to the audit committee."),
      p("N.ia.findings", "Three high-risk findings: inventory counts at the Dammam warehouse did not reconcile with the ledger; quarterly user access reviews of the finance system were not done; and changes to vendor bank details were made without a second approval."),
      p("N.ia.medium", "Two medium-risk findings: travel advances older than 90 days were not settled, and the fixed asset register lacked tag numbers for 14 items."),
    ]],
  },
  {
    key: "N.whistle", project: "board", title: "سياسة الإبلاغ عن المخالفات GOV-POL-11.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.whistle.chan", "سياسة الإبلاغ عن المخالفات (GOV-POL-11). تُرفع البلاغات إلى رئيس لجنة المراجعة مباشرة عبر البريد الإلكتروني المخصص أو صندوق البلاغات المغلق، ويجوز أن يكون البلاغ دون ذكر الاسم."),
      p("N.whistle.ack", "يُشعر المبلغ باستلام بلاغه خلال عشرة أيام عمل، ويُحمى من أي إجراء انتقامي بسبب بلاغ قدمه بحسن نية."),
    ]],
  },
  {
    key: "N.strategy", project: "board", title: "محضر لقاء الاستراتيجية للمجلس 2026.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("N.strategy.head", "لقاء المجلس السنوي للاستراتيجية، الخبر، 20 و21 يونيو 2026."),
      p("N.strategy.prio", "اتفق المجلس على ثلاث أولويات للسنوات الثلاث القادمة: التوسع في قطاع الخدمات اللوجستية، وخفض المديونية إلى أقل من 40% من حقوق الملكية، وإنشاء وحدة للتحول الرقمي تتبع الرئيس التنفيذي."),
      p("N.strategy.next", "طلب المجلس من الإدارة التنفيذية تقديم خطة تفصيلية لكل أولوية في اجتماع سبتمبر 2026."),
    ]],
  },
  {
    key: "N.notes", project: "board", title: "ملاحظات المستشار الداخلية.txt", lang: "ar", by: "khalid", visibility: "firm_private", kind: "text",
    pages: [[
      p("N.notes.score", "ملاحظات داخلية لا تشارك مع العميل. درجة نضج الحوكمة المبدئية للنخبة: 2.1 من 5. المدير المالي متحفظ على تشكيل لجنة المراجعة ويؤخر الترشيحات."),
    ]],
  },
];

// Monthly management reports, 2025: one figure set each, so the search must tell the months apart.
export const N_MR = MONTHS_EN.map((m, i) => ({
  month: m,
  revenue: (38.4 + i * 0.9 + (i % 3) * 0.4).toFixed(1),
  ebitda: 14 + ((i * 7) % 6),
  headcount: 412 + i * 6,
  dso: 61 + ((i * 5) % 17),
}));
for (const [i, r] of N_MR.entries()) {
  NUKHBA.push({
    key: `N.mr.${pad(i + 1)}`, project: "board", title: `Management report ${r.month} 2025.txt`, lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`N.mr.${pad(i + 1)}.sum`, `Al-Nukhba Holding, management report for ${r.month} 2025. Revenue for the month was SAR ${r.revenue} million, the EBITDA margin was ${r.ebitda}%, headcount at month end was ${r.headcount}, and receivable days stood at ${r.dso}.`),
      p(`N.mr.${pad(i + 1)}.note`, `Commentary for ${r.month} 2025: management will report again on collections and staffing at the next monthly review.`),
    ]],
  });
}

// Nominations and remuneration committee, meetings 1 to 8.
export const N_NRC = [
  "التوصية بترشيح عضوين مستقلين جديدين للمجلس",
  "اعتماد مؤشرات أداء الرئيس التنفيذي لعام 2025",
  "مراجعة سلم رواتب الإدارة العليا ورفعه للمجلس",
  "اعتماد خطة الإحلال للمناصب التنفيذية الحرجة",
  "التوصية بصرف مكافأة الأداء السنوية بنسبة 85% من المستهدف",
  "تكليف جهة خارجية بدراسة مقارنة لمكافآت أعضاء المجلس",
  "اعتماد برنامج تهيئة الأعضاء الجدد",
  "التوصية بتجديد عقد الرئيس التنفيذي لثلاث سنوات",
];
for (const [i, d] of N_NRC.entries()) {
  NUKHBA.push({
    key: `N.nrc.${i + 1}`, project: "board", title: `محضر لجنة الترشيحات والمكافآت رقم ${i + 1}.txt`, lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`N.nrc.${i + 1}.dec`, `محضر الاجتماع رقم ${i + 1} للجنة الترشيحات والمكافآت في شركة النخبة القابضة، بتاريخ 2025-${pad(i + 2)}-15. قررت اللجنة: ${d}.`),
    ]],
  });
}

// Vendor contracts.
export const N_VENDORS = [
  { name: "Qimam Data Systems", service: "ERP hosting and support", value: "SAR 1,240,000", months: 36, notice: 90 },
  { name: "Rimal Facility Care", service: "cleaning and building maintenance", value: "SAR 480,000", months: 24, notice: 60 },
  { name: "Ufuq Print House", service: "printing of annual reports", value: "SAR 95,000", months: 12, notice: 30 },
  { name: "Dar Al-Rasm Design", service: "brand and website design", value: "SAR 210,000", months: 12, notice: 45 },
  { name: "Wadi Freight Lines", service: "inland freight", value: "SAR 2,900,000", months: 36, notice: 120 },
  { name: "Saqr Security Services", service: "guarding of the head office", value: "SAR 360,000", months: 24, notice: 60 },
  { name: "Manar Training Academy", service: "staff training", value: "SAR 150,000", months: 12, notice: 30 },
  { name: "Sanad Legal Partners", service: "corporate legal advice", value: "SAR 540,000", months: 24, notice: 90 },
  { name: "Ghaim Telecom Solutions", service: "office telephony and internet", value: "SAR 310,000", months: 36, notice: 60 },
  { name: "Nabaa Water Supply", service: "drinking water delivery", value: "SAR 28,000", months: 12, notice: 15 },
];
for (const [i, v] of N_VENDORS.entries()) {
  NUKHBA.push({
    key: `N.vendor.${i + 1}`, project: "board", title: `Contract summary - ${v.name}.txt`, lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`N.vendor.${i + 1}.terms`, `Contract summary. Supplier: ${v.name}. Service: ${v.service}. Total contract value: ${v.value} over ${v.months} months. Either party must give ${v.notice} days' written notice before the renewal date to end the contract.`),
    ]],
  });
}

// HR circulars.
export const N_HR = [
  { subject: "ساعات العمل المرنة", from: "2025-09-01", rule: "يجوز للموظف بدء الدوام بين الساعة السابعة والتاسعة صباحاً مع الالتزام بثماني ساعات يومياً" },
  { subject: "العمل عن بعد", from: "2025-10-01", rule: "يحق للموظف العمل عن بعد يوماً واحداً في الأسبوع بموافقة مديره المباشر" },
  { subject: "الإجازة السنوية", from: "2026-01-01", rule: "يجب استنفاد رصيد الإجازة السنوية المرحل قبل نهاية شهر مارس" },
  { subject: "بدل السكن", from: "2025-07-01", rule: "يُصرف بدل السكن مقدماً عن ثلاثة أشهر بدلاً من سنة" },
  { subject: "التأمين الطبي", from: "2026-02-01", rule: "يشمل التأمين الطبي الوالدين بمساهمة من الموظف قدرها 30%" },
  { subject: "قواعد السفر", from: "2025-11-15", rule: "يسافر الموظفون على الدرجة السياحية في الرحلات التي تقل عن خمس ساعات" },
  { subject: "التطوير المهني", from: "2026-03-01", rule: "يحق لكل موظف خمسة أيام تدريب مدفوعة في السنة" },
  { subject: "الهدايا والضيافة", from: "2025-08-01", rule: "يُمنع قبول الهدايا التي تزيد قيمتها على 500 ريال ويجب الإفصاح عن أي هدية" },
];
for (const [i, h] of N_HR.entries()) {
  NUKHBA.push({
    key: `N.hr.${i + 1}`, project: "board", title: `تعميم الموارد البشرية - ${h.subject}.txt`, lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`N.hr.${i + 1}.rule`, `تعميم إدارة الموارد البشرية بشأن ${h.subject}، يعمل به اعتباراً من ${h.from}: ${h.rule}.`),
    ]],
  });
}

// Training attendance (mixed): English course titles, Arabic notes.
export const N_TRAINING = [
  { course: "Corporate Governance Fundamentals", n: 18, place: "الرياض" },
  { course: "Risk Management for Directors", n: 11, place: "جدة" },
  { course: "IFRS Update 2026", n: 24, place: "الرياض" },
  { course: "Anti-Bribery and Corruption", n: 37, place: "الدمام" },
  { course: "Board Secretary Essentials", n: 6, place: "عن بعد" },
  { course: "Data Protection Basics", n: 29, place: "عن بعد" },
];
for (const [i, t] of N_TRAINING.entries()) {
  NUKHBA.push({
    key: `N.training.${i + 1}`, project: "board", title: `Training record - ${t.course}.txt`, lang: "mixed", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`N.training.${i + 1}.rec`, `Training record: ${t.course}. سجل الحضور: حضر الدورة ${t.n} موظفاً في ${t.place}، وقيّم المشاركون الدورة بأنها مفيدة لعملهم.`),
    ]],
  });
}

// ----------------------------------------------- Al-Waha Family Office (waha)

const WAHA: CorpusFile[] = [
  {
    key: "W.charter", project: "waha", title: "مسودة ميثاق العائلة.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.charter.council", "مكتب الواحة العائلي. مسودة ميثاق العائلة. يتكون مجلس العائلة من سبعة أعضاء يمثلون الفروع الثلاثة، ويرأسه ماجد الواحي لمدة أربع سنوات."),
      p("W.charter.shares", "لا يجوز بيع أي حصة لغير أفراد العائلة إلا بموافقة ثلثي أعضاء مجلس العائلة، وللفروع الأخرى حق الأولوية في الشراء خلال ستين يوماً."),
      p("W.charter.assembly", "تجتمع الجمعية العائلية مرة في السنة، ويحق لكل فرد من العائلة بلغ الثامنة عشرة حضورها."),
    ]],
  },
  {
    key: "W.employ", project: "waha", title: "سياسة توظيف أفراد العائلة.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.employ.req", "سياسة توظيف أفراد العائلة: يشترط لتوظيف فرد من العائلة في الشركات العائلية الحصول على درجة البكالوريوس على الأقل، وخبرة عمل لا تقل عن ثلاث سنوات خارج شركات العائلة."),
      p("W.employ.pay", "يتقاضى فرد العائلة العامل في الشركة راتباً مماثلاً لراتب غير أفراد العائلة في الوظيفة نفسها، ويخضع لتقييم الأداء ذاته."),
    ]],
  },
  {
    key: "W.div.v1", project: "waha", title: "سياسة توزيع الأرباح العائلية 2022.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.div.v1.rate", "سياسة توزيع الأرباح، الإصدار المعتمد من مجلس العائلة في 2022-06-12: تُوزع على المساهمين من العائلة نسبة 30% من صافي الأرباح السنوية، ويُعاد استثمار الباقي."),
    ]],
  },
  {
    key: "W.div.v2", project: "waha", title: "سياسة توزيع الأرباح العائلية - مسودة 2026.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.div.v2.rate", "سياسة توزيع الأرباح، مسودة مقترحة في سبتمبر 2026 لم يعتمدها مجلس العائلة بعد: رفع النسبة الموزعة على المساهمين من العائلة إلى 40% من صافي الأرباح السنوية."),
    ]],
  },
  {
    key: "W.ips", project: "waha", title: "Investment policy statement.txt", lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.ips.alloc", "Al-Waha Family Office, investment policy statement. Target allocation: 40% real estate, 25% listed equities, 20% private investments, 10% fixed income and 5% cash."),
      p("W.ips.limits", "No single investment may exceed 10% of the portfolio, and the investment committee reviews the allocation every six months."),
    ]],
  },
  {
    key: "W.succ", project: "waha", title: "Succession plan - family holding.txt", lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      clause("W.succ.purpose", "Al-Waha family holding, succession plan. Section 1, purpose: this plan sets how the leadership of the family holding passes to the next generation in an orderly way.", "en", 0),
      clause("W.succ.principle", "Section 2, principle: the next chief executive of the family holding is chosen by the family council on the recommendation of a nominations panel that includes two members from outside the family.", "en", 1),
      clause("W.succ.elig", "Section 3, eligibility: a family candidate needs a master's degree or ten years of senior experience, including at least five years outside the family's companies.", "en", 2),
      clause("W.succ.timeline", "Section 4, timeline: the current managing director, Majed Al-Wahi, steps down at the end of 2028. The panel shortlists candidates by June 2027.", "en", 3),
      clause("W.succ.interim", "Section 5, emergency succession: if the managing director cannot serve, the chief financial officer, Tariq Al-Hamdan, who is not a family member, acts as managing director for up to twelve months.", "en", 4),
      clause("W.succ.develop", "Section 6, development: shortlisted candidates rotate through two operating companies and sit on one board as observers before the decision.", "en", 5),
    ], [
      clause("W.succ.review", "Section 7, review: the family council reviews this plan every two years and after any major change in the family holding.", "en", 6),
      clause("W.succ.comms", "Section 8, communication: the family council informs the family assembly of the decision and its reasons, and the holding informs its banks and partners.", "en", 7),
      clause("W.succ.ownership", "Section 9, ownership: shares pass under each owner's will in line with the family charter; succession in management does not change ownership.", "en", 8),
    ]],
  },
  {
    key: "W.minutes.2026-01", project: "waha", title: "محضر مجلس العائلة يناير 2026.txt", lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.minutes.jan", "محضر اجتماع مجلس العائلة، 18 يناير 2026. قرر المجلس: إنشاء صندوق تعليمي لأبناء العائلة برأس مال مليوني ريال، وتكليف المكتب العائلي بإعداد لائحة الجمعية العائلية قبل نهاية مارس 2026."),
    ]],
  },
  {
    key: "W.assembly", project: "waha", title: "Family assembly invitation - دعوة الجمعية العائلية.txt", lang: "mixed", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.assembly.inv", "Invitation to the annual family assembly, 12 December 2026, Al-Waha farm. جدول الأعمال: عرض القوائم المالية، وانتخاب ممثلي الجيل الثالث في مجلس العائلة، ومناقشة مسودة سياسة توزيع الأرباح."),
    ]],
  },
  {
    key: "W.faq", project: "waha", title: "Family constitution FAQ.txt", lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p("W.faq.inlaws", "Can in-laws attend the family assembly? Yes, spouses of family members may attend as guests and speak, but they do not vote."),
      p("W.faq.minors", "Can family members under eighteen attend? They may attend the open session with a parent, not the voting session."),
    ]],
  },
];

export const W_PORTFOLIO = ["2024 Q1", "2024 Q2", "2024 Q3", "2024 Q4", "2025 Q1", "2025 Q2", "2025 Q3", "2025 Q4"].map((q, i) => ({
  quarter: q,
  value: (612 + i * 11 - (i === 5 ? 9 : 0)).toString(),
  realEstate: 43 - (i % 4),
}));
for (const [i, r] of W_PORTFOLIO.entries()) {
  WAHA.push({
    key: `W.pr.${i + 1}`, project: "waha", title: `Portfolio report ${r.quarter}.txt`, lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`W.pr.${i + 1}.sum`, `Al-Waha Family Office, portfolio report for ${r.quarter}. Total portfolio value at quarter end was SAR ${r.value} million, with real estate at ${r.realEstate}% of the portfolio.`),
    ]],
  });
}

export const W_COUNCIL = [
  "اعتماد ميزانية المكتب العائلي لعام 2025",
  "تعيين مستشار مستقل لمراجعة الاستثمارات العقارية",
  "اعتماد برنامج تدريب الجيل الثالث",
  "تأجيل بيع أرض الرمال إلى ما بعد التقييم المستقل",
  "إنشاء لجنة للأعمال الخيرية من خمسة أعضاء",
  "زيادة رأس مال صندوق التعليم إلى ثلاثة ملايين ريال",
  "اعتماد مدونة سلوك أفراد العائلة",
  "طلب تقرير ربع سنوي عن أداء الشركات التشغيلية",
  "تحديث سجل المساهمين من العائلة",
  "اعتماد موعد الجمعية العائلية السنوية",
];
for (const [i, d] of W_COUNCIL.entries()) {
  WAHA.push({
    key: `W.council.${i + 1}`, project: "waha", title: `محضر مجلس العائلة رقم ${i + 1}.txt`, lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`W.council.${i + 1}.dec`, `محضر الاجتماع رقم ${i + 1} لمجلس عائلة الواحة. قرر المجلس: ${d}.`),
    ]],
  });
}

export const W_NEXTGEN = [
  { topic: "Financial literacy", speaker: "لمى العتيبي" },
  { topic: "Reading financial statements", speaker: "سلطان القحطاني" },
  { topic: "Family values and history", speaker: "ماجد الواحي" },
  { topic: "Introduction to investing", speaker: "طارق الحمدان" },
  { topic: "Philanthropy", speaker: "نوف الشهري" },
  { topic: "Working in the family business", speaker: "بدر الغامدي" },
  { topic: "Negotiation skills", speaker: "هيفاء الدوسري" },
  { topic: "Board observer training", speaker: "عبدالعزيز السبيعي" },
];
for (const [i, s] of W_NEXTGEN.entries()) {
  WAHA.push({
    key: `W.nextgen.${i + 1}`, project: "waha", title: `Next-gen session ${i + 1} - ${s.topic}.txt`, lang: "mixed", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`W.nextgen.${i + 1}.rec`, `Next generation programme, session ${i + 1}: ${s.topic}. قدّم الجلسة ${s.speaker}، وحضرها ${9 + i} من أبناء الجيل الثالث.`),
    ]],
  });
}

export const W_LEASES = [
  { property: "Al-Malqa warehouse", tenant: "Wadi Freight Lines", rent: "SAR 1,150,000", until: "2028-06-30" },
  { property: "Al-Rabwa office floor 3", tenant: "Ghaim Telecom Solutions", rent: "SAR 640,000", until: "2027-12-31" },
  { property: "Al-Nakheel retail unit 12", tenant: "Ufuq Bookshop", rent: "SAR 210,000", until: "2027-03-31" },
  { property: "Al-Sulai workshop", tenant: "Saqr Engineering", rent: "SAR 380,000", until: "2029-01-31" },
  { property: "Al-Olaya apartment block", tenant: "Manar Training Academy", rent: "SAR 920,000", until: "2028-09-30" },
  { property: "Al-Khobar showroom", tenant: "Rimal Furniture", rent: "SAR 560,000", until: "2027-08-31" },
  { property: "Jeddah cold store", tenant: "Nabaa Foods", rent: "SAR 1,480,000", until: "2030-05-31" },
  { property: "Al-Yasmin clinic building", tenant: "Shifa Medical", rent: "SAR 1,020,000", until: "2029-10-31" },
  { property: "Al-Hamra parking plot", tenant: "Masar Parking", rent: "SAR 130,000", until: "2026-12-31" },
  { property: "Taif farm guesthouse", tenant: "Wahat Tourism", rent: "SAR 240,000", until: "2027-05-31" },
];
for (const [i, l] of W_LEASES.entries()) {
  WAHA.push({
    key: `W.lease.${i + 1}`, project: "waha", title: `Lease summary - ${l.property}.txt`, lang: "en", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`W.lease.${i + 1}.terms`, `Lease summary. Property: ${l.property}. Tenant: ${l.tenant}. Annual rent: ${l.rent}. The lease expires on ${l.until}.`),
    ]],
  });
}

export const W_CHARITY = [
  { to: "جمعية البر في الخرج", amount: "250,000" },
  { to: "مبادرة سقيا الماء في جازان", amount: "180,000" },
  { to: "منح دراسية لطلاب الطب", amount: "400,000" },
  { to: "جمعية رعاية الأيتام في الأحساء", amount: "300,000" },
  { to: "برنامج محو الأمية الرقمية", amount: "120,000" },
  { to: "ترميم مسجد القرية القديم", amount: "90,000" },
  { to: "بنك الطعام في الرياض", amount: "150,000" },
  { to: "مركز التوحد في الدمام", amount: "220,000" },
];
for (const [i, c] of W_CHARITY.entries()) {
  WAHA.push({
    key: `W.charity.${i + 1}`, project: "waha", title: `قرار لجنة الأعمال الخيرية رقم ${i + 1}.txt`, lang: "ar", by: "khalid", visibility: "shared", kind: "text",
    pages: [[
      p(`W.charity.${i + 1}.dec`, `قرار لجنة الأعمال الخيرية لعائلة الواحة رقم ${i + 1}: تخصيص مبلغ ${c.amount} ريال لصالح ${c.to}.`),
    ]],
  });
}

// ------------------------------------------------ Rawdah Foundation (rawdah)

const RAWDAH: CorpusFile[] = [
  {
    key: "R.plan", project: "rawdah", title: "Rawdah strategic plan 2027 draft.txt", lang: "en", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p("R.plan.g1", "Rawdah Foundation, strategic plan 2027 (draft 3). Goal 1: award 40 university scholarships to orphans in Jeddah and Taif by December 2027."),
      p("R.plan.g2", "Goal 2: raise the share of income from endowment (waqf) returns to 35% of total income."),
      p("R.plan.kpi", "The board treasurer, Hind Al-Zahrani, owns the fundraising KPI and reports on it every quarter."),
    ]],
  },
  {
    key: "R.grants", project: "rawdah", title: "سياسة المنح.txt", lang: "ar", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p("R.grants.cap", "سياسة المنح في مؤسسة الروضة: لا تتجاوز المنحة الواحدة 60,000 ريال في السنة الدراسية، وتُصرف على دفعتين في بداية كل فصل."),
      p("R.grants.approve", "تعتمد لجنة المستفيدين المنح التي تقل عن 30,000 ريال، وما زاد على ذلك يعتمده مجلس الأمناء."),
    ]],
  },
  {
    key: "R.schol", project: "rawdah", title: "معايير أهلية المنح الجامعية.txt", lang: "ar", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p("R.schol.criteria", "يشترط للحصول على المنحة الجامعية: أن يكون الطالب يتيماً مسجلاً لدى المؤسسة، وألا يقل معدله في الثانوية عن 85%، وأن يحصل على قبول في جامعة معترف بها."),
    ]],
  },
  {
    key: "R.volpol", project: "rawdah", title: "سياسة التطوع.txt", lang: "ar", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p("R.volpol.age", "سياسة التطوع: يشترط ألا يقل عمر المتطوع عن ثمانية عشر عاماً، ويجوز مشاركة من بلغ الخامسة عشرة بموافقة ولي أمره في الفعاليات العامة فقط."),
      p("R.volpol.check", "يخضع كل متطوع يعمل مع الأطفال لفحص السجل والتدريب على سياسة حماية الطفل قبل بدء العمل."),
    ]],
  },
  {
    key: "R.minutes.2025-09", project: "rawdah", title: "Board of trustees minutes September 2025.txt", lang: "en", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p("R.minutes.sep", "Rawdah Foundation, board of trustees, 24 September 2025. The board approved opening the Taif mentoring centre, raised the scholarship budget by 15%, and asked for a donor retention report at the next meeting."),
    ]],
  },
  {
    key: "R.kpi", project: "rawdah", title: "KPI dictionary.txt", lang: "en", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p("R.kpi.retention", "Donor retention rate: the share of donors who gave in the previous year and gave again this year, measured each December."),
      p("R.kpi.mentoring", "Mentoring coverage: the share of registered orphans aged 12 to 18 who have an active mentor, measured each quarter."),
    ]],
  },
  {
    key: "R.annual", project: "rawdah", title: "التقرير السنوي 2025.txt", lang: "ar", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      clause("R.annual.chair", "مؤسسة الروضة الخيرية، التقرير السنوي لعام 2025. كلمة رئيس مجلس الأمناء: كان عام 2025 عام البناء المؤسسي وتوسيع البرامج في جدة والطائف.", "ar", 0),
      clause("R.annual.schol", "المنح الجامعية: قدمت المؤسسة 28 منحة جامعية في عام 2025، من أصل 40 منحة مستهدفة بنهاية عام 2027.", "ar", 1),
      clause("R.annual.endow", "الأوقاف: بلغت حصة عوائد الأوقاف 22% من إجمالي إيرادات المؤسسة في عام 2025.", "ar", 2),
      clause("R.annual.vol", "التطوع: شارك 410 متطوعين في برامج المؤسسة، بإجمالي 9,800 ساعة تطوعية.", "ar", 3),
      clause("R.annual.programs", "البرامج: يخدم برنامج الإرشاد الأيتام من عمر 12 إلى 18 عاماً في جدة والطائف، ويلتقي كل مرشد بالمستفيد مرتين في الشهر.", "ar", 4),
    ], [
      clause("R.annual.fin", "المالية: بلغ إجمالي الإيرادات 14.2 مليون ريال، وذهبت 78% من المصروفات إلى البرامج مباشرة.", "ar", 5),
      clause("R.annual.gov", "الحوكمة: اجتمع مجلس الأمناء خمس مرات في عام 2025، وأصدر المراجع الخارجي رأياً غير متحفظ على القوائم المالية.", "ar", 6),
      clause("R.annual.partners", "الشراكات: وقعت المؤسسة اتفاقيات شراكة مع ست جامعات لتسهيل قبول الطلاب المستفيدين.", "ar", 7),
      clause("R.annual.challenges", "التحديات: تأخر افتتاح مركز الطائف إلى الربع الثاني من عام 2026 بسبب تأخر تصاريح البناء.", "ar", 8),
      clause("R.annual.plans", "خطط 2026: إطلاق برنامج للمنح المهنية، وزيادة عدد المرشدين بنسبة 30%.", "ar", 9),
    ]],
  },
];

export const R_MONTHLY = MONTHS_AR.map((m, i) => ({ month: m, sessions: 120 + i * 14, newBeneficiaries: 8 + (i % 5) * 3 }));
for (const [i, r] of R_MONTHLY.entries()) {
  RAWDAH.push({
    key: `R.pr.${pad(i + 1)}`, project: "rawdah", title: `تقرير البرامج الشهري ${r.month} 2025.txt`, lang: "ar", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p(`R.pr.${pad(i + 1)}.sum`, `مؤسسة الروضة، تقرير البرامج لشهر ${r.month} 2025: نُفذت ${r.sessions} جلسة إرشاد، وانضم ${r.newBeneficiaries} مستفيدين جدد إلى البرنامج.`),
    ]],
  });
}

export const R_DONORS = [
  { donor: "Sanabel Foundation", amount: "SAR 750,000", purpose: "scholarships for orphans in Taif" },
  { donor: "Amal Charitable Trust", amount: "SAR 300,000", purpose: "the mentoring programme in Jeddah" },
  { donor: "Nour Family Endowment", amount: "SAR 1,200,000", purpose: "building the Taif centre" },
  { donor: "Hilal Giving Circle", amount: "SAR 90,000", purpose: "school supplies" },
  { donor: "Bayader Trust", amount: "SAR 410,000", purpose: "vocational training grants" },
  { donor: "Tasnim Fund", amount: "SAR 150,000", purpose: "mentor training" },
  { donor: "Zahra Endowment", amount: "SAR 600,000", purpose: "the endowment fund" },
  { donor: "Rayan Philanthropy", amount: "SAR 220,000", purpose: "summer camps" },
  { donor: "Wafa Benevolent Fund", amount: "SAR 80,000", purpose: "emergency support" },
  { donor: "Sidra Community Fund", amount: "SAR 330,000", purpose: "university transport" },
];
for (const [i, d] of R_DONORS.entries()) {
  RAWDAH.push({
    key: `R.donor.${i + 1}`, project: "rawdah", title: `Donor agreement - ${d.donor}.txt`, lang: "en", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p(`R.donor.${i + 1}.terms`, `Donor agreement with ${d.donor}: a grant of ${d.amount}, restricted to ${d.purpose}, with a narrative report due within 60 days of year end.`),
    ]],
  });
}

export const R_EVENTS = [
  { name: "Ramadan food baskets", n: 85 }, { name: "Back to school day", n: 60 }, { name: "Beach clean-up Jeddah", n: 42 },
  { name: "Eid gifts drive", n: 110 }, { name: "Career fair for students", n: 25 }, { name: "Reading club launch", n: 18 },
  { name: "Taif hiking day", n: 30 }, { name: "National Day celebration", n: 70 },
];
for (const [i, e] of R_EVENTS.entries()) {
  RAWDAH.push({
    key: `R.event.${i + 1}`, project: "rawdah", title: `Volunteer event - ${e.name}.txt`, lang: "mixed", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p(`R.event.${i + 1}.rec`, `Volunteer event: ${e.name}. شارك في الفعالية ${e.n} متطوعاً، وأُعد تقرير مصور عنها لمجلس الأمناء.`),
    ]],
  });
}

export const R_PROCUREMENT = [
  { item: "30 laptops for the mentoring centre", winner: "Qimam Data Systems", value: "SAR 96,000" },
  { item: "two minibuses", winner: "Wadi Motors", value: "SAR 410,000" },
  { item: "printing of the annual report", winner: "Ufuq Print House", value: "SAR 22,000" },
  { item: "furniture for the Taif centre", winner: "Rimal Furniture", value: "SAR 185,000" },
  { item: "accounting software", winner: "Hisab Cloud", value: "SAR 38,000" },
  { item: "security cameras", winner: "Saqr Security Services", value: "SAR 54,000" },
  { item: "school bags and stationery", winner: "Qalam Supplies", value: "SAR 47,000" },
  { item: "website redesign", winner: "Dar Al-Rasm Design", value: "SAR 64,000" },
];
for (const [i, r] of R_PROCUREMENT.entries()) {
  RAWDAH.push({
    key: `R.proc.${i + 1}`, project: "rawdah", title: `Procurement record ${i + 1}.txt`, lang: "en", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p(`R.proc.${i + 1}.rec`, `Procurement record: ${r.item}. Three quotations were compared; the award went to ${r.winner} for ${r.value}.`),
    ]],
  });
}

export const R_BENEF = [
  "قبول 12 طالباً جديداً في برنامج المنح",
  "رفع الإعانة الشهرية للأسر المستفيدة إلى 1,200 ريال",
  "إيقاف منحة طالب لعدم استيفاء المعدل المطلوب",
  "اعتماد قائمة المرشدين الجدد",
  "تحويل حالتين إلى برنامج الدعم النفسي",
  "الموافقة على منحة مهنية في مجال التمريض",
  "تمديد مهلة تقديم مستندات القبول أسبوعين",
  "اعتماد معايير برنامج المنح المهنية",
];
for (const [i, d] of R_BENEF.entries()) {
  RAWDAH.push({
    key: `R.benef.${i + 1}`, project: "rawdah", title: `محضر لجنة المستفيدين رقم ${i + 1}.txt`, lang: "ar", by: "noura", visibility: "shared", kind: "text",
    pages: [[
      p(`R.benef.${i + 1}.dec`, `محضر اجتماع لجنة المستفيدين رقم ${i + 1} في مؤسسة الروضة. قررت اللجنة: ${d}.`),
    ]],
  });
}

export const CORPUS: CorpusFile[] = [...NUKHBA, ...WAHA, ...RAWDAH];

/** The file's text as uploaded: passages separated by blank lines, pages by a form feed. */
export function fileText(f: CorpusFile): string {
  return f.pages.map((page) => page.map((x) => x.text).join("\n\n")).join("\n\f");
}

export const passageById = new Map(CORPUS.flatMap((f) => f.pages.flat().map((x) => [x.id, { ...x, file: f.key }] as const)));

// The labelled test set's questions (section 7 item 7). Each names the
// passages that hold its answer by id (corpus.ts), or the records (actions)
// by title as "act:<title>", so retrieval and citations are scored without a
// model. Synthetic only.
//
// The "reference" group is about the reference library planned in Gate B
// (lead-log "Gate B answers", part 1): published governance and strategy
// works kept apart from client evidence. Those works are NOT in this set and
// no text of theirs is copied here: the questions only say what such a
// source would cover. Until the library exists, the right result is "I can't
// confirm this", with no client file passed off as the reference.
import { N_HR, N_MR, N_TRAINING, N_VENDORS, R_MONTHLY, R_PROCUREMENT, W_CHARITY, W_LEASES, W_NEXTGEN, W_PORTFOLIO } from "./corpus";

export type Group =
  | "facts-en"
  | "facts-ar"
  | "cross-language"
  | "versions"
  | "versions-ar"
  | "long-file"
  | "scanned"
  | "similar-files"
  | "exact-term"
  | "follow-up"
  | "follow-up-across"
  | "due-this-week"
  | "status"
  | "across-clients"
  | "cannot"
  | "leak-probe"
  | "reference";

export type ReferenceSource = "IFC family business governance handbook" | "OECD corporate governance principles" | "CMA corporate governance regulations" | "Balanced Scorecard" | "Good Strategy Bad Strategy" | "Ministry of Economy and Planning strategy framework";

export interface Question {
  id: string;
  group: Group;
  user: "khalid" | "noura";
  /** "all": "All my clients" (no project picked). */
  project: "board" | "waha" | "rawdah" | "all";
  lang: "ar" | "en";
  q: string;
  /** Continues the chat of this question (full runs only; retrieval reads the question alone, as the product does). */
  follow?: string;
  /** Passage ids (corpus.ts) or "act:<action title>" that hold the answer. Any one is enough for a hit; all are needed for full recall. */
  gold: string[];
  /** "answer": grounded answer expected; "cannot": "I can't confirm"; "either": both are acceptable. */
  expect: "answer" | "cannot" | "either";
  /** A quick content check: the answer contains one of these. The hand review decides. */
  any?: string[];
  /** Must not appear in what is sent to the model or in the answer. */
  never?: string[];
  /** Reference group only: the work the question is about, and its topic. */
  ref?: { source: ReferenceSource; topic: string };
}

const mr = (i: number) => N_MR[i - 1]!;

export const QUESTIONS: Question[] = [
  // ------------------------------------------------ Al-Nukhba (board), Khalid
  { id: "N01", group: "facts-en", user: "khalid", project: "board", lang: "en", q: "What did the board decide about the audit committee at meeting 14?", gold: ["N.min14.audit"], expect: "answer", any: ["three", "3"] },
  { id: "N02", group: "facts-en", user: "khalid", project: "board", lang: "en", q: "By when must the audit committee chair be nominated?", gold: ["N.min14.audit"], expect: "answer", any: ["30 April", "April 30"] },
  { id: "N03", group: "facts-en", user: "khalid", project: "board", lang: "en", q: "Which related-party contracts must management list for the next meeting?", gold: ["N.min14.rp"], expect: "answer", any: ["500,000", "500000"] },
  { id: "N04", group: "cross-language", user: "khalid", project: "board", lang: "ar", q: "ماذا طلب المراجع الخارجي في اجتماع المجلس رقم 14؟", gold: ["N.min14.aud"], expect: "answer", any: ["الجرد", "inventory", "المخزون"] },
  { id: "N05", group: "facts-ar", user: "khalid", project: "board", lang: "ar", q: "خلال كم يوماً يجب على عضو المجلس الإفصاح عن تعارض المصالح؟", gold: ["N.coi.a12"], expect: "answer", any: ["15", "خمسة عشر", "١٥"] },
  { id: "N06", group: "cross-language", user: "khalid", project: "board", lang: "en", q: "What does GOV-POL-07 say about voting on a matter in which a member has an interest?", gold: ["N.coi.a13"], expect: "answer", any: ["abstain", "refrain", "not vote", "may not vote"] },
  { id: "N07", group: "facts-ar", user: "khalid", project: "board", lang: "ar", q: "من يراجع سجل الإفصاحات سنوياً وإلى من يرفعه؟", gold: ["N.coi.a18"], expect: "answer", any: ["أمين سر", "أمين السر"] },
  { id: "N08", group: "versions-ar", user: "khalid", project: "board", lang: "ar", q: "ما الحد الأعلى للمكافأة السنوية لعضو مجلس الإدارة؟", gold: ["N.rem.v2.cap", "N.rem.v2.status", "N.rem.v1.cap"], expect: "answer", any: ["500,000", "500٬000", "٥٠٠"] },
  { id: "N09", group: "versions-ar", user: "khalid", project: "board", lang: "ar", q: "هل ما زال الإصدار الأول من سياسة المكافآت سارياً؟", gold: ["N.rem.v2.status"], expect: "answer", any: ["لا", "يحل", "حل محل", "ألغى", "يلغيه", "ملغى"] },
  { id: "N10", group: "versions-ar", user: "khalid", project: "board", lang: "ar", q: "كم بدل حضور جلسة مجلس الإدارة في سياسة المكافآت المعمول بها؟", gold: ["N.rem.v2.allow", "N.rem.v2.status"], expect: "answer", any: ["5,000", "5000", "٥٬٠٠٠", "٥٠٠٠"] },
  { id: "N11", group: "versions", user: "khalid", project: "board", lang: "en", q: "What is the CEO's capital expenditure approval limit?", gold: ["N.doa.2024.capex", "N.doa.2026.capex"], expect: "answer", any: ["1,000,000"] },
  { id: "N12", group: "versions-ar", user: "khalid", project: "board", lang: "ar", q: "ما هو حد صلاحية الرئيس التنفيذي لاعتماد النفقات الرأسمالية؟", gold: ["N.doa.2024.capex", "N.doa.2026.capex"], expect: "answer", any: ["1,000,000", "١٬٠٠٠٬٠٠٠", "مليون"] },
  { id: "N13", group: "versions-ar", user: "khalid", project: "board", lang: "ar", q: "هل اعتمدت مصفوفة الصلاحيات لعام 2026؟", gold: ["N.doa.2026.capex"], expect: "answer", any: ["مسودة", "لم تعتمد", "لم يتم"] },
  { id: "N14", group: "long-file", user: "khalid", project: "board", lang: "en", q: "How many members does the board have under its charter, and how many must be independent?", gold: ["N.charter.comp"], expect: "answer", any: ["nine", "9"] },
  { id: "N15", group: "long-file", user: "khalid", project: "board", lang: "ar", q: "كم اجتماعاً يجب أن يعقده مجلس الإدارة في السنة؟", gold: ["N.charter.meet"], expect: "answer", any: ["أربعة", "4", "٤"] },
  { id: "N16", group: "long-file", user: "khalid", project: "board", lang: "ar", q: "ما النصاب اللازم لصحة اجتماع مجلس الإدارة؟", gold: ["N.charter.quorum"], expect: "answer", any: ["نصف"] },
  { id: "N17", group: "long-file", user: "khalid", project: "board", lang: "en", q: "How often must an external party evaluate the board?", gold: ["N.charter.eval"], expect: "answer", any: ["three years", "3 years"] },
  { id: "N18", group: "long-file", user: "khalid", project: "board", lang: "ar", q: "متى يجب إرسال جدول أعمال اجتماع المجلس إلى الأعضاء؟", gold: ["N.charter.agenda"], expect: "answer", any: ["سبعة", "7", "٧"] },
  { id: "N19", group: "long-file", user: "khalid", project: "board", lang: "en", q: "Can the chair of the board also be the CEO?", gold: ["N.charter.chair"], expect: "answer", any: ["not", "no", "cannot"] },
  { id: "N20", group: "long-file", user: "khalid", project: "board", lang: "en", q: "How many times a year must the audit committee meet?", gold: ["N.acharter.meet"], expect: "answer", any: ["six", "6"] },
  { id: "N21", group: "cross-language", user: "khalid", project: "board", lang: "ar", q: "هل يشترط ميثاق لجنة المراجعة وجود عضو ذي خبرة مالية؟", gold: ["N.acharter.member"], expect: "answer", any: ["نعم", "محاسب", "مالية", "مالي"] },
  { id: "N22", group: "long-file", user: "khalid", project: "board", lang: "en", q: "How often must the lead external audit partner rotate?", gold: ["N.acharter.ext"], expect: "answer", any: ["five", "5"] },
  { id: "N23", group: "long-file", user: "khalid", project: "board", lang: "en", q: "To whom does the head of internal audit report?", gold: ["N.acharter.ia"], expect: "answer", any: ["committee"] },
  { id: "N24", group: "facts-en", user: "khalid", project: "board", lang: "en", q: "What high-risk findings did the Q2 2026 internal audit report raise?", gold: ["N.ia.findings"], expect: "answer", any: ["inventory", "access", "vendor"] },
  { id: "N25", group: "facts-ar", user: "khalid", project: "board", lang: "ar", q: "ما مهلة إشعار المبلغ باستلام بلاغه في سياسة الإبلاغ عن المخالفات؟", gold: ["N.whistle.ack"], expect: "answer", any: ["عشرة", "10", "١٠"] },
  { id: "N26", group: "cross-language", user: "khalid", project: "board", lang: "en", q: "Who receives whistleblowing reports under GOV-POL-11?", gold: ["N.whistle.chan", "N.acharter.whistle"], expect: "answer", any: ["audit committee"] },
  { id: "N27", group: "scanned", user: "khalid", project: "board", lang: "en", q: "What is attached on page 2 of the related-party register cover letter?", gold: ["N.scan.p1"], expect: "answer", any: ["register", "signed"] },
  { id: "N28", group: "scanned", user: "khalid", project: "board", lang: "en", q: "Which related parties and contract values does the signed, scanned register list?", gold: [], expect: "cannot", any: [] },
  { id: "N29", group: "cross-language", user: "khalid", project: "board", lang: "ar", q: "ما نقاط التحسين التي خرجت بها ورشة تقييم المجلس؟", gold: ["N.workshop.out"], expect: "answer", any: ["مبكر", "الاستراتيجية", "متابعة"] },
  { id: "N30", group: "facts-ar", user: "khalid", project: "board", lang: "ar", q: "ما الأولويات الثلاث التي اتفق عليها المجلس في لقاء الاستراتيجية؟", gold: ["N.strategy.prio"], expect: "answer", any: ["اللوجستية", "المديونية", "الرقمي"] },
  { id: "N31", group: "facts-ar", user: "khalid", project: "board", lang: "ar", q: "ما درجة نضج الحوكمة المبدئية للنخبة؟", gold: ["N.notes.score"], expect: "answer", any: ["2.1", "٢٫١", "2٫1"] },
  { id: "N32", group: "similar-files", user: "khalid", project: "board", lang: "en", q: "What revenue did the June 2025 management report show?", gold: ["N.mr.06.sum"], expect: "answer", any: [mr(6).revenue] },
  { id: "N33", group: "similar-files", user: "khalid", project: "board", lang: "ar", q: "كم كان هامش EBITDA في تقرير الإدارة لشهر نوفمبر 2025؟", gold: ["N.mr.11.sum"], expect: "answer", any: [`${mr(11).ebitda}`] },
  { id: "N34", group: "similar-files", user: "khalid", project: "board", lang: "en", q: "What was the headcount at the end of March 2025?", gold: ["N.mr.03.sum"], expect: "answer", any: [`${mr(3).headcount}`] },
  { id: "N35", group: "similar-files", user: "khalid", project: "board", lang: "ar", q: "ما الذي قررته لجنة الترشيحات والمكافآت في اجتماعها رقم 5؟", gold: ["N.nrc.5.dec"], expect: "answer", any: ["85"] },
  { id: "N36", group: "similar-files", user: "khalid", project: "board", lang: "en", q: "What is the total value of the contract with Qimam Data Systems?", gold: ["N.vendor.1.terms"], expect: "answer", any: [N_VENDORS[0]!.value.replace("SAR ", "")] },
  { id: "N37", group: "similar-files", user: "khalid", project: "board", lang: "en", q: "How many days' notice does the Rimal Facility Care contract need before renewal?", gold: ["N.vendor.2.terms"], expect: "answer", any: [`${N_VENDORS[1]!.notice}`] },
  { id: "N38", group: "similar-files", user: "khalid", project: "board", lang: "ar", q: "متى يبدأ العمل بتعميم ساعات العمل المرنة؟", gold: ["N.hr.1.rule"], expect: "answer", any: [N_HR[0]!.from, "سبتمبر"] },
  { id: "N39", group: "cross-language", user: "khalid", project: "board", lang: "en", q: "How many staff attended the Corporate Governance Fundamentals course?", gold: ["N.training.1.rec"], expect: "answer", any: [`${N_TRAINING[0]!.n}`] },
  { id: "N40", group: "cannot", user: "khalid", project: "board", lang: "en", q: "What is the company's dividend policy?", gold: [], expect: "cannot" },
  { id: "N41", group: "cannot", user: "khalid", project: "board", lang: "ar", q: "ما سياسة سفر أعضاء مجلس الإدارة على الدرجة الأولى؟", gold: [], expect: "cannot" },
  { id: "N42", group: "exact-term", user: "khalid", project: "board", lang: "en", q: "GOV-POL-11", gold: ["N.whistle.chan", "N.whistle.ack", "N.acharter.whistle"], expect: "either" },
  { id: "N43", group: "exact-term", user: "khalid", project: "board", lang: "en", q: "R-14/2", gold: ["N.min14.rp", "N.min14.aud"], expect: "either" },
  { id: "N44", group: "follow-up", user: "khalid", project: "board", lang: "en", follow: "N01", q: "And who will chair it?", gold: ["N.min14.audit"], expect: "answer", any: ["independent"] },
  { id: "N45", group: "follow-up", user: "khalid", project: "board", lang: "ar", follow: "N08", q: "ومتى اعتمد الإصدار الأحدث؟", gold: ["N.rem.v2.status"], expect: "answer", any: ["2026-05-10", "10 مايو", "مايو 2026"] },
  { id: "N46", group: "due-this-week", user: "khalid", project: "board", lang: "ar", q: "ما المستحق هذا الأسبوع؟", gold: ["act:مقارنة إصداري سياسة المكافآت", "act:إعداد مذكرة للجمعية العامة", "act:رفع الميثاق المعتمد"], expect: "answer", any: ["مقارنة إصداري", "مذكرة", "رفع الميثاق"] },
  { id: "N47", group: "due-this-week", user: "khalid", project: "board", lang: "en", q: "What is due this week on this project?", gold: ["act:مقارنة إصداري سياسة المكافآت", "act:إعداد مذكرة للجمعية العامة", "act:رفع الميثاق المعتمد"], expect: "answer", any: ["مقارنة إصداري", "مذكرة", "رفع الميثاق"] },
  { id: "N48", group: "status", user: "khalid", project: "board", lang: "en", q: "What is overdue on this project?", gold: ["act:اختيار أعضاء اللجنة", "act:إعداد لائحة عمل اللجنة"], expect: "answer", any: ["اختيار أعضاء اللجنة", "إعداد لائحة عمل اللجنة"] },
  { id: "N49", group: "status", user: "khalid", project: "board", lang: "ar", q: "ما الإجراءات المتعثرة ولماذا؟", gold: ["act:اختيار أعضاء اللجنة"], expect: "answer", any: ["اختيار أعضاء اللجنة"] },
  { id: "N50", group: "status", user: "khalid", project: "board", lang: "en", q: "What is awaiting review?", gold: ["act:رفع الميثاق المعتمد"], expect: "answer", any: ["رفع الميثاق المعتمد"] },

  // --------------------------------------------- Al-Waha (waha), Khalid
  { id: "W01", group: "facts-ar", user: "khalid", project: "waha", lang: "ar", q: "من يرأس مجلس العائلة؟", gold: ["W.charter.council"], expect: "answer", any: ["ماجد"] },
  { id: "W02", group: "facts-ar", user: "khalid", project: "waha", lang: "ar", q: "كم عدد أعضاء مجلس العائلة؟", gold: ["W.charter.council"], expect: "answer", any: ["سبعة", "7", "٧"] },
  { id: "W03", group: "facts-ar", user: "khalid", project: "waha", lang: "ar", q: "ما شرط بيع حصة لغير أفراد العائلة؟", gold: ["W.charter.shares"], expect: "answer", any: ["ثلثي"] },
  { id: "W04", group: "cross-language", user: "khalid", project: "waha", lang: "en", q: "What qualifications does a family member need to work in the family companies?", gold: ["W.employ.req"], expect: "answer", any: ["bachelor", "three years", "3 years"] },
  { id: "W05", group: "versions-ar", user: "khalid", project: "waha", lang: "ar", q: "ما نسبة الأرباح التي توزع على المساهمين من العائلة؟", gold: ["W.div.v1.rate", "W.div.v2.rate"], expect: "answer", any: ["30", "٣٠"] },
  { id: "W06", group: "versions-ar", user: "khalid", project: "waha", lang: "ar", follow: "W05", q: "وأي النسختين هي المعتمدة اليوم؟", gold: ["W.div.v1.rate", "W.div.v2.rate"], expect: "answer", any: ["2022", "30", "٣٠"] },
  { id: "W07", group: "facts-en", user: "khalid", project: "waha", lang: "en", q: "What is the target allocation to real estate in the investment policy?", gold: ["W.ips.alloc"], expect: "answer", any: ["40"] },
  { id: "W08", group: "long-file", user: "khalid", project: "waha", lang: "en", q: "Who acts as managing director in an emergency, and for how long?", gold: ["W.succ.interim"], expect: "answer", any: ["Tariq", "twelve", "12"] },
  { id: "W09", group: "long-file", user: "khalid", project: "waha", lang: "en", q: "When does the current managing director step down?", gold: ["W.succ.timeline"], expect: "answer", any: ["2028"] },
  { id: "W10", group: "cross-language", user: "khalid", project: "waha", lang: "ar", q: "من يختار الرئيس التنفيذي القادم للشركة القابضة العائلية؟", gold: ["W.succ.principle"], expect: "answer", any: ["مجلس العائلة"] },
  { id: "W11", group: "facts-ar", user: "khalid", project: "waha", lang: "ar", q: "ما قرارات اجتماع مجلس العائلة في يناير 2026؟", gold: ["W.minutes.jan"], expect: "answer", any: ["صندوق", "تعليم"] },
  { id: "W12", group: "similar-files", user: "khalid", project: "waha", lang: "en", q: "What was the total portfolio value at the end of 2025 Q3?", gold: ["W.pr.7.sum"], expect: "answer", any: [W_PORTFOLIO[6]!.value] },
  { id: "W13", group: "similar-files", user: "khalid", project: "waha", lang: "en", q: "What is the annual rent of the Al-Malqa warehouse and when does the lease expire?", gold: ["W.lease.1.terms"], expect: "answer", any: [W_LEASES[0]!.rent.replace("SAR ", "")] },
  { id: "W14", group: "similar-files", user: "khalid", project: "waha", lang: "ar", q: "كم المبلغ الذي خصصته لجنة الأعمال الخيرية لبنك الطعام في الرياض؟", gold: ["W.charity.7.dec"], expect: "answer", any: [W_CHARITY[6]!.amount] },
  { id: "W15", group: "cross-language", user: "khalid", project: "waha", lang: "ar", q: "من قدّم جلسة Financial literacy لأبناء الجيل الثالث؟", gold: ["W.nextgen.1.rec"], expect: "answer", any: [W_NEXTGEN[0]!.speaker.split(" ")[0]!] },
  { id: "W16", group: "cross-language", user: "khalid", project: "waha", lang: "en", q: "When is the family assembly and what is on its agenda?", gold: ["W.assembly.inv"], expect: "answer", any: ["12 December", "December 12"] },
  { id: "W17", group: "cannot", user: "khalid", project: "waha", lang: "ar", q: "ما سياسة العائلة في استخدام الطائرة الخاصة؟", gold: [], expect: "cannot" },
  { id: "W18", group: "facts-en", user: "khalid", project: "waha", lang: "en", q: "Can in-laws attend the family assembly, and can they vote?", gold: ["W.faq.inlaws"], expect: "answer", any: ["not vote", "do not vote", "cannot vote", "no"] },
  { id: "W19", group: "similar-files", user: "khalid", project: "waha", lang: "ar", q: "ماذا قرر مجلس العائلة بشأن صندوق التعليم في اجتماعه رقم 6؟", gold: ["W.council.6.dec"], expect: "answer", any: ["ثلاثة ملايين"] },
  { id: "W20", group: "similar-files", user: "khalid", project: "waha", lang: "en", q: "Which tenant leases floor 3 of the Al-Rabwa office?", gold: ["W.lease.2.terms"], expect: "answer", any: [W_LEASES[1]!.tenant.split(" ")[0]!] },

  // --------------------------------------------- Rawdah (rawdah), Noura
  { id: "R01", group: "cross-language", user: "noura", project: "rawdah", lang: "ar", q: "كم عدد المنح الجامعية المستهدفة في الخطة الاستراتيجية؟", gold: ["R.plan.g1"], expect: "answer", any: ["40", "٤٠", "أربعين"] },
  { id: "R02", group: "facts-en", user: "noura", project: "rawdah", lang: "en", q: "What share of income should come from endowment returns under the plan?", gold: ["R.plan.g2"], expect: "answer", any: ["35"] },
  { id: "R03", group: "facts-en", user: "noura", project: "rawdah", lang: "en", q: "Who owns the fundraising KPI?", gold: ["R.plan.kpi"], expect: "answer", any: ["Hind"] },
  { id: "R04", group: "long-file", user: "noura", project: "rawdah", lang: "ar", q: "كم منحة جامعية قدمت المؤسسة في عام 2025؟", gold: ["R.annual.schol"], expect: "answer", any: ["28", "٢٨"] },
  { id: "R05", group: "long-file", user: "noura", project: "rawdah", lang: "en", q: "What share of income came from the endowment in 2025?", gold: ["R.annual.endow"], expect: "answer", any: ["22"] },
  { id: "R06", group: "long-file", user: "noura", project: "rawdah", lang: "ar", q: "كم عدد المتطوعين وساعات التطوع في عام 2025؟", gold: ["R.annual.vol"], expect: "answer", any: ["410", "٤١٠"] },
  { id: "R07", group: "long-file", user: "noura", project: "rawdah", lang: "en", q: "Why was the opening of the Taif centre delayed?", gold: ["R.annual.challenges"], expect: "answer", any: ["permit"] },
  { id: "R08", group: "facts-ar", user: "noura", project: "rawdah", lang: "ar", q: "ما الحد الأعلى للمنحة الواحدة في سياسة المنح؟", gold: ["R.grants.cap"], expect: "answer", any: ["60,000", "60000", "٦٠"] },
  { id: "R09", group: "facts-ar", user: "noura", project: "rawdah", lang: "ar", q: "ما شروط الأهلية للمنحة الجامعية؟", gold: ["R.schol.criteria"], expect: "answer", any: ["85", "يتيم"] },
  { id: "R10", group: "facts-en", user: "noura", project: "rawdah", lang: "en", q: "How is the donor retention rate defined?", gold: ["R.kpi.retention"], expect: "answer", any: ["previous year", "again"] },
  { id: "R11", group: "facts-en", user: "noura", project: "rawdah", lang: "en", q: "What did the board of trustees decide in September 2025?", gold: ["R.minutes.sep"], expect: "answer", any: ["Taif", "15%"] },
  { id: "R12", group: "similar-files", user: "noura", project: "rawdah", lang: "ar", q: "كم جلسة إرشاد نفذت في شهر مايو 2025؟", gold: ["R.pr.05.sum"], expect: "answer", any: [`${R_MONTHLY[4]!.sessions}`] },
  { id: "R13", group: "similar-files", user: "noura", project: "rawdah", lang: "en", q: "What is the Sanabel Foundation grant restricted to?", gold: ["R.donor.1.terms"], expect: "answer", any: ["scholarship"] },
  { id: "R14", group: "facts-ar", user: "noura", project: "rawdah", lang: "ar", q: "ما الحد الأدنى لعمر المتطوع؟", gold: ["R.volpol.age"], expect: "answer", any: ["ثمانية عشر", "18", "١٨"] },
  { id: "R15", group: "similar-files", user: "noura", project: "rawdah", lang: "en", q: "Which supplier won the laptop procurement, and for how much?", gold: ["R.proc.1.rec"], expect: "answer", any: [R_PROCUREMENT[0]!.winner.split(" ")[0]!] },
  { id: "R16", group: "cannot", user: "noura", project: "rawdah", lang: "en", q: "What is the foundation's investment policy for the endowment fund?", gold: [], expect: "cannot" },
  { id: "R17", group: "long-file", user: "noura", project: "rawdah", lang: "en", q: "How many universities does the foundation have partnership agreements with?", gold: ["R.annual.partners"], expect: "answer", any: ["six", "6"] },
  { id: "R18", group: "long-file", user: "noura", project: "rawdah", lang: "ar", q: "ما الفئة العمرية التي يخدمها برنامج الإرشاد؟", gold: ["R.annual.programs", "R.kpi.mentoring"], expect: "answer", any: ["12", "18"] },

  // ------------------------------------- All my clients (Khalid: Al-Nukhba and Al-Waha)
  { id: "AC01", group: "across-clients", user: "khalid", project: "all", lang: "en", q: "Which actions are overdue across my clients?", gold: ["act:اختيار أعضاء اللجنة", "act:إعداد لائحة عمل اللجنة", "act:مراجعة سجل المساهمين"], expect: "answer", any: ["اختيار أعضاء اللجنة", "مراجعة سجل المساهمين"], never: ["Rawdah", "الروضة"] },
  { id: "AC02", group: "across-clients", user: "khalid", project: "all", lang: "ar", q: "ما الإجراءات المتأخرة لدى عملائي؟", gold: ["act:اختيار أعضاء اللجنة", "act:إعداد لائحة عمل اللجنة", "act:مراجعة سجل المساهمين"], expect: "answer", any: ["اختيار أعضاء اللجنة", "مراجعة سجل المساهمين"], never: ["الروضة"] },
  { id: "AC03", group: "follow-up-across", user: "khalid", project: "all", lang: "en", follow: "AC01", q: "Which client is the first one for?", gold: [], expect: "answer", any: ["Nukhba", "النخبة", "Waha", "الواحة"], never: ["Rawdah", "الروضة"] },
  { id: "AC04", group: "across-clients", user: "khalid", project: "all", lang: "ar", q: "من يرأس مجلس العائلة؟", gold: ["W.charter.council"], expect: "answer", any: ["ماجد"] },
  { id: "AC05", group: "across-clients", user: "khalid", project: "all", lang: "en", q: "What did the board decide about the audit committee?", gold: ["N.min14.audit"], expect: "answer", any: ["three", "3"] },
  { id: "AC06", group: "follow-up-across", user: "khalid", project: "all", lang: "ar", follow: "AC05", q: "وهل لدى عميلي الآخر لجنة مشابهة؟", gold: [], expect: "either", never: ["Rawdah", "الروضة"] },
  { id: "AC07", group: "due-this-week", user: "khalid", project: "all", lang: "en", q: "What is due this week across my clients?", gold: ["act:مقارنة إصداري سياسة المكافآت", "act:إعداد مذكرة للجمعية العامة", "act:رفع الميثاق المعتمد", "act:إعداد لائحة الجمعية العائلية"], expect: "answer", any: ["مقارنة إصداري", "مذكرة", "رفع الميثاق", "لائحة الجمعية"] },
  { id: "AC08", group: "follow-up-across", user: "khalid", project: "all", lang: "ar", follow: "AC07", q: "وأيها لعميل الواحة؟", gold: ["act:إعداد لائحة الجمعية العائلية"], expect: "answer", any: ["لائحة الجمعية"] },

  // ------------------------------------------------------------- leak probes
  { id: "L01", group: "leak-probe", user: "khalid", project: "all", lang: "en", q: "How many scholarships does Rawdah Foundation plan to award?", gold: [], expect: "cannot", never: ["scholarships to orphans", "Sanabel"] },
  { id: "L02", group: "leak-probe", user: "noura", project: "all", lang: "en", q: "What did Al-Nukhba's board decide about the audit committee?", gold: [], expect: "cannot", never: ["three members", "30 April", "Reem"] },
  { id: "L03", group: "leak-probe", user: "khalid", project: "board", lang: "en", q: "What share of Rawdah's income came from its endowment?", gold: [], expect: "cannot", never: ["22%", "35%", "عوائد الأوقاف"] },
  { id: "L04", group: "leak-probe", user: "noura", project: "rawdah", lang: "ar", q: "ما شروط بيع الحصص في ميثاق عائلة الواحة؟", gold: [], expect: "cannot", never: ["ثلثي", "سبعة أعضاء"] },

  // ------------------------------------------- reference library (not built yet)
  { id: "REF01", group: "reference", user: "khalid", project: "waha", lang: "en", q: "According to the IFC family business governance handbook, which family governance bodies does a family business usually set up?", gold: [], expect: "cannot", ref: { source: "IFC family business governance handbook", topic: "family governance institutions (assembly, council, office)" } },
  { id: "REF02", group: "reference", user: "khalid", project: "waha", lang: "ar", q: "ما الذي يوصي به دليل مؤسسة التمويل الدولية لحوكمة الشركات العائلية بشأن توظيف أفراد العائلة؟", gold: [], expect: "cannot", ref: { source: "IFC family business governance handbook", topic: "family employment policy" } },
  { id: "REF03", group: "reference", user: "khalid", project: "waha", lang: "en", q: "What stages of a family business's life does the IFC handbook describe, and what changes at each stage?", gold: [], expect: "cannot", ref: { source: "IFC family business governance handbook", topic: "stages of family business development" } },
  { id: "REF04", group: "reference", user: "khalid", project: "board", lang: "en", q: "What do the OECD corporate governance principles say about the rights and fair treatment of shareholders?", gold: [], expect: "cannot", ref: { source: "OECD corporate governance principles", topic: "shareholder rights and equitable treatment" } },
  { id: "REF05", group: "reference", user: "khalid", project: "board", lang: "ar", q: "ما مسؤوليات مجلس الإدارة كما تعرضها مبادئ منظمة التعاون الاقتصادي والتنمية لحوكمة الشركات؟", gold: [], expect: "cannot", ref: { source: "OECD corporate governance principles", topic: "responsibilities of the board" } },
  { id: "REF06", group: "reference", user: "khalid", project: "board", lang: "en", q: "How do the OECD principles treat disclosure and transparency?", gold: [], expect: "cannot", ref: { source: "OECD corporate governance principles", topic: "disclosure and transparency" } },
  { id: "REF07", group: "reference", user: "khalid", project: "board", lang: "ar", q: "ما متطلبات لائحة حوكمة الشركات الصادرة عن هيئة السوق المالية بشأن عدد الأعضاء المستقلين في المجلس؟", gold: [], expect: "cannot", ref: { source: "CMA corporate governance regulations", topic: "independent board members" } },
  { id: "REF08", group: "reference", user: "khalid", project: "board", lang: "en", q: "What do the CMA corporate governance regulations require of an audit committee's membership?", gold: [], expect: "cannot", ref: { source: "CMA corporate governance regulations", topic: "audit committee composition" } },
  { id: "REF09", group: "reference", user: "khalid", project: "board", lang: "ar", q: "هل تسمح لائحة حوكمة الشركات لهيئة السوق المالية بالجمع بين رئاسة المجلس ومنصب الرئيس التنفيذي؟", gold: [], expect: "cannot", ref: { source: "CMA corporate governance regulations", topic: "separating the chair and CEO roles" } },
  { id: "REF10", group: "reference", user: "noura", project: "rawdah", lang: "en", q: "What are the four perspectives of the Balanced Scorecard?", gold: [], expect: "cannot", ref: { source: "Balanced Scorecard", topic: "the four perspectives" } },
  { id: "REF11", group: "reference", user: "noura", project: "rawdah", lang: "ar", q: "كيف تربط بطاقة الأداء المتوازن الأهداف الاستراتيجية بالمؤشرات؟", gold: [], expect: "cannot", ref: { source: "Balanced Scorecard", topic: "linking objectives to measures" } },
  { id: "REF12", group: "reference", user: "noura", project: "rawdah", lang: "en", q: "What is a strategy map in the Balanced Scorecard method?", gold: [], expect: "cannot", ref: { source: "Balanced Scorecard", topic: "strategy maps" } },
  { id: "REF13", group: "reference", user: "khalid", project: "board", lang: "en", q: "What does Good Strategy Bad Strategy call the core of a good strategy?", gold: [], expect: "cannot", ref: { source: "Good Strategy Bad Strategy", topic: "the kernel of a strategy" } },
  { id: "REF14", group: "reference", user: "khalid", project: "board", lang: "ar", q: "ما علامات الاستراتيجية السيئة بحسب كتاب الاستراتيجية الجيدة والاستراتيجية السيئة لريتشارد روملت؟", gold: [], expect: "cannot", ref: { source: "Good Strategy Bad Strategy", topic: "hallmarks of bad strategy" } },
  { id: "REF15", group: "reference", user: "khalid", project: "board", lang: "en", q: "How does Rumelt distinguish setting goals from having a strategy?", gold: [], expect: "cannot", ref: { source: "Good Strategy Bad Strategy", topic: "goals versus strategy" } },
  { id: "REF16", group: "reference", user: "noura", project: "rawdah", lang: "ar", q: "ما مراحل إعداد الخطة الاستراتيجية في إطار وزارة الاقتصاد والتخطيط؟", gold: [], expect: "cannot", ref: { source: "Ministry of Economy and Planning strategy framework", topic: "stages of preparing a strategic plan" } },
  { id: "REF17", group: "reference", user: "noura", project: "rawdah", lang: "en", q: "What does the Ministry of Economy and Planning framework expect an organisation's strategic plan to align with?", gold: [], expect: "cannot", ref: { source: "Ministry of Economy and Planning strategy framework", topic: "alignment with national plans" } },
  { id: "REF18", group: "reference", user: "noura", project: "rawdah", lang: "ar", q: "كيف يقترح إطار وزارة الاقتصاد والتخطيط متابعة مؤشرات الأداء الاستراتيجية؟", gold: [], expect: "cannot", ref: { source: "Ministry of Economy and Planning strategy framework", topic: "following up performance indicators" } },
];

/** The 20 questions answered in full on a slow model: every weak case of the 19 Nov run, and a spread of the rest. */
export const FULL_SAMPLE = [
  "N01", "N44", // follow-up
  "N08", "N45", "N12", "W05", "W06", // conflicting versions in Arabic, with follow-ups
  "N11", // versions, English
  "N17", "N20", "W08", // long files
  "N27", "N28", // scanned
  "N46", "AC07", "AC08", // due this week, with a follow-up across clients
  "AC01", "AC03", // follow-up across clients
  "N33", "REF04", // similar files; reference
];


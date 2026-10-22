import type { OwnBasis, ChoiceOption, LegalForm, QuestionType } from "@/lib/assessments";

// The starter family-governance template: the team's proposed questions,
// not an official assessment of any regulator, publisher or firm. Each one
// names the source it is informed by and where in it; the basis is what it
// is for a non-listed family company, and legalFor/guidanceFor say for which
// legal forms it is binding, or regulator guidance, instead. Source map:
// research thread, 2026-10-21 (docs/assessments.md lists the sources).
//
// Article and section numbers were checked against full copies of the texts
// on 2026-10-22 (assessment source map, section 6): the CMA regulations as
// amended in 2023, the OECD 2023 principles, the IFC handbook, Companies Law
// Art. 11(2), the MoC 2018 decision record and SAMA's key principles.

// Citations not yet checked against the source's current text. The MoC
// family charter is known only as a reported draft, so 2.3's chapter stays
// unverified; 3.4 because the MoC 2018 rules set no confirmed meeting count.
export const UNVERIFIED_CITATIONS = new Set(["2.3", "3.4"]);

export interface StarterQuestion {
  ref: string;
  prompt: string;
  promptAr: string;
  type: QuestionType;
  options?: ChoiceOption[];
  basis: OwnBasis;
  legalFor?: LegalForm[];
  guidanceFor?: LegalForm[];
  citation: string | null;
  locator: string | null;
  guidance?: string;
  guidanceAr?: string;
  appliesIf?: { ref: string; values: string[] };
}

const DD = "Deep Dive methodology session (2026)";
const IFC = "IFC Family Business Governance Handbook (2nd ed., 2008)";
const OECD = "G20/OECD Principles of Corporate Governance (2023)";
const CMA = "CMA Corporate Governance Regulations (listed companies; as amended 2023)";
const MOC = "Ministry of Commerce governance regulations for non-listed joint stock companies (2018, guidance)";
const SAMA = "SAMA Key Principles of Governance in Financial Institutions (2021)";
const CL = "Companies Law (2022)";
// Regulator guidance, non-binding unless the family adopts a charter under the
// Companies Law. Reported as "the proposed draft" (Okaz, 18 May 2018), so it is
// cited by chapter only and the questions keep their good_practice basis.
const MOC_FC = "MoC Guiding Charter for Saudi Family Businesses (2018, regulator guidance, non-binding)";

// The family ownership questions apply only to a family-owned or family-controlled company.
const FAMILY = { ref: "0.1", values: ["family"] };

export const STARTER_TEMPLATE = {
  name: "Family business governance: starter assessment",
  nameAr: "حوكمة الشركات العائلية: تقييم مبدئي",
  description:
    "The team's starter questions across eight governance areas, each informed by a named source. Edit before publishing. Scores are indicative and are not a certification of legal compliance.",
  descriptionAr:
    "أسئلة مبدئية مقترحة من الفريق في ثمانية محاور للحوكمة، كل سؤال مستند إلى مصدر مذكور. عدّلها قبل النشر. النتائج مؤشرات وليست شهادة امتثال نظامي.",
  sections: [
    {
      title: "Company profile",
      titleAr: "بيانات الشركة",
      questions: [
        {
          ref: "0.1",
          prompt: "Is the company family-owned or family-controlled?",
          promptAr: "هل الشركة مملوكة لعائلة أو تسيطر عليها عائلة؟",
          // Not scored (every option scores 0): it only decides whether the family questions apply.
          type: "multiple_choice",
          options: [
            { value: "family", label: "Yes", labelAr: "نعم", points: 0 },
            { value: "not_family", label: "No", labelAr: "لا", points: 0 },
          ],
          basis: "team_proposed",
          citation: null,
          locator: null,
          guidance: "Not scored. The family ownership questions (2.1 to 2.5 and 5.2) apply only when the answer is yes.",
          guidanceAr: "لا يُحتسب في النتيجة. أسئلة الملكية العائلية (من 2.1 إلى 2.5 و5.2) تنطبق فقط عند الإجابة بنعم.",
        },
      ],
    },
    {
      title: "Governance structure and accountability",
      titleAr: "هيكل الحوكمة والمساءلة",
      questions: [
        q("1.1", "Is there an approved organisational structure?", "هل يوجد هيكل تنظيمي معتمد؟", "firm_method", DD, "pp. 13, 16"),
        q(
          "1.2",
          "Are each department's responsibilities defined in writing?",
          "هل مسؤوليات كل إدارة محددة كتابيًا؟",
          "firm_method",
          DD,
          "p. 13",
        ),
        q(
          "1.3",
          "Is a named role responsible for governance and compliance?",
          "هل يوجد دور محدد مسؤول عن الحوكمة والالتزام؟",
          "firm_method",
          DD,
          "p. 20",
        ),
      ],
    },
    {
      title: "Family ownership and decision-making",
      titleAr: "الملكية العائلية واتخاذ القرار",
      questions: [
        {
          ...q(
            "2.1",
            "Does the family have a written family charter?",
            "هل لدى العائلة ميثاق عائلي مكتوب؟",
            "good_practice",
            `${IFC}; ${CL}, family charter: binding once adopted, not required; ${MOC_FC}`,
            "IFC Sec. II.1; Companies Law Art. 11(2); MoC-FC, whole charter (reported draft)",
          ),
          guidance: "A gap here can be answered with a recommendation to draft a family charter, which the firm can deliver.",
          guidanceAr: "يمكن معالجة الفجوة هنا بتوصية بإعداد ميثاق عائلي، ويمكن للمكتب إعداده.",
          appliesIf: FAMILY,
        },
        {
          ref: "2.2",
          prompt: "Which family governance bodies exist?",
          promptAr: "ما هيئات الحوكمة العائلية القائمة؟",
          type: "multiple_choice",
          options: [
            { value: "none", label: "None", labelAr: "لا يوجد", points: 0 },
            { value: "informal", label: "Informal family meetings", labelAr: "اجتماعات عائلية غير رسمية", points: 1 },
            { value: "assembly", label: "Family assembly", labelAr: "جمعية عائلية", points: 2 },
            { value: "council", label: "Family council", labelAr: "مجلس عائلة", points: 3 },
          ],
          basis: "good_practice",
          citation: `${IFC}; ${MOC_FC}`,
          locator: "IFC Sec. II.2; MoC-FC, family council chapter",
          appliesIf: FAMILY,
        },
        {
          ...q(
            "2.3",
            "Is there a written policy on employing family members?",
            "هل توجد سياسة مكتوبة لتوظيف أفراد العائلة؟",
            "good_practice",
            `${IFC}; ${MOC_FC}`,
            "IFC Sec. II.1.1; MoC-FC, company work policy chapter (to verify)",
          ),
          appliesIf: FAMILY,
        },
        {
          ...q(
            "2.4",
            "Are the rules for share transfers, exits and profit distribution among family owners written down?",
            "هل قواعد نقل الحصص والتخارج وتوزيع الأرباح بين الملاك من العائلة مكتوبة؟",
            "good_practice",
            `${IFC}; ${CL}, scope of a family charter; ${MOC_FC}`,
            "IFC Sec. II.1.2; Companies Law Art. 11; MoC-FC, share disposal and exit chapter",
          ),
          appliesIf: FAMILY,
        },
        {
          ref: "2.5",
          prompt: "How are major decisions made today?",
          promptAr: "كيف تُتخذ القرارات الرئيسية حاليًا؟",
          type: "multiple_choice",
          options: [
            { value: "one_person", label: "By one person", labelAr: "من شخص واحد", points: 0 },
            { value: "informal_consensus", label: "By informal family consensus", labelAr: "بتوافق عائلي غير رسمي", points: 1 },
            { value: "documented", label: "By documented authority", labelAr: "وفق صلاحيات موثقة", points: 2 },
          ],
          basis: "firm_method",
          citation: DD,
          locator: "pp. 8, 16 (decision-making baseline)",
          appliesIf: FAMILY,
        },
      ],
    },
    {
      title: "Board or management responsibilities",
      titleAr: "مسؤوليات مجلس الإدارة أو الإدارة",
      questions: [
        {
          ref: "3.1",
          prompt: "What oversight body exists?",
          promptAr: "ما جهة الإشراف القائمة؟",
          type: "multiple_choice",
          options: [
            { value: "none", label: "None", labelAr: "لا يوجد", points: 0 },
            { value: "advisory_board", label: "Advisory board", labelAr: "مجلس استشاري", points: 1 },
            { value: "board", label: "Board of directors", labelAr: "مجلس إدارة", points: 2 },
          ],
          basis: "good_practice",
          citation: IFC,
          locator: "Sec. III",
        },
        {
          ...q(
            "3.2",
            "Does the board include independent or non-family members?",
            "هل يضم المجلس أعضاء مستقلين أو من خارج العائلة؟",
            "good_practice",
            `${IFC}; ${CMA}; ${OECD}; ${SAMA}`,
            "IFC Sec. III.3; CMA Art. 16; OECD V.E; SAMA Art. 7 (financial institutions)",
          ),
          guidance:
            'For a listed company, "yes" does not confirm CMA Art. 16: at least two independent directors or one-third of the board, whichever is greater, and a non-executive majority. Check the numbers.',
          guidanceAr:
            "في الشركة المدرجة، الإجابة بنعم لا تؤكد الالتزام بالمادة 16 من لائحة حوكمة الشركات: عضوان مستقلان على الأقل أو ثلث المجلس أيهما أكثر، وأغلبية غير تنفيذية. تحقق من الأعداد.",
          legalFor: ["listed_jsc", "bank_or_finance_company"],
          appliesIf: { ref: "3.1", values: ["advisory_board", "board"] },
        },
        {
          ...q(
            "3.3",
            "Are the board's and executive management's responsibilities separated in writing?",
            "هل مسؤوليات المجلس والإدارة التنفيذية مفصولة كتابيًا؟",
            "good_practice",
            `${IFC}; ${OECD}; ${CMA}`,
            "IFC Sec. III.2 and IV; OECD V (V.D.4); CMA Art. 23(b) when listed (the chair may not be CEO)",
          ),
          // Art. 23(b) binds the separation of chair and CEO, not this written split as a whole.
        },
        {
          ...q(
            "3.4",
            "Does the board or management committee meet on a fixed schedule with minutes kept?",
            "هل يجتمع المجلس أو لجنة الإدارة بانتظام وتُحفظ محاضر الاجتماعات؟",
            "good_practice",
            `${CMA}; ${SAMA}; ${IFC}; ${MOC}`,
            "CMA Art. 30(b) and 35 when listed; SAMA Art. 22 for banks and finance companies; IFC Sec. III.2 otherwise; MoC 2018: guidance; periodic meetings",
          ),
          legalFor: ["listed_jsc", "bank_or_finance_company"],
          guidanceFor: ["closed_jsc"],
          appliesIf: { ref: "3.1", values: ["advisory_board", "board"] },
        },
      ],
    },
    {
      title: "Delegation of authority",
      titleAr: "تفويض الصلاحيات",
      questions: [
        q(
          "4.1",
          "Is there an approved delegation-of-authority matrix?",
          "هل توجد مصفوفة صلاحيات معتمدة؟",
          "firm_method",
          DD,
          "pp. 7, 13, 16",
        ),
        {
          ...q(
            "4.2",
            "Does it state who decides what, and up to which limit?",
            "هل تحدد من يقرر ماذا، وإلى أي حد؟",
            "firm_method",
            DD,
            "p. 13",
          ),
          appliesIf: { ref: "4.1", values: ["yes", "partly"] },
        },
        {
          ref: "4.3",
          prompt: "How consistently are decisions taken according to the matrix? (1 = rarely, 4 = always)",
          promptAr: "إلى أي مدى تُتخذ القرارات وفق المصفوفة؟ (1 = نادرًا، 4 = دائمًا)",
          type: "rating",
          basis: "firm_method",
          citation: DD,
          locator: "p. 25",
          appliesIf: { ref: "4.1", values: ["yes", "partly"] },
        },
      ],
    },
    {
      title: "Succession planning",
      titleAr: "التخطيط للتعاقب",
      questions: [
        {
          ...q(
            "5.1",
            "Is there a written succession plan for the CEO and other key roles?",
            "هل توجد خطة تعاقب مكتوبة للرئيس التنفيذي والأدوار الرئيسية؟",
            "good_practice",
            `${IFC}; ${OECD}; ${SAMA}`,
            "IFC Sec. IV.2; OECD V.D.4; SAMA Arts. 39 and 87(a) (financial institutions)",
          ),
          legalFor: ["bank_or_finance_company"],
        },
        {
          ...q(
            "5.2",
            "Are there agreed rules for preparing the next generation and for how they join the business?",
            "هل توجد قواعد متفق عليها لإعداد الجيل القادم وطريقة انضمامه إلى العمل؟",
            "good_practice",
            IFC,
            "Introduction; Sec. II",
          ),
          appliesIf: FAMILY,
        },
      ],
    },
    {
      title: "Policies and operating procedures",
      titleAr: "السياسات وإجراءات العمل",
      questions: [
        q(
          "6.1",
          "Are the core policies written and approved?",
          "هل السياسات الأساسية مكتوبة ومعتمدة؟",
          "firm_method",
          DD,
          "pp. 7, 13, 21",
        ),
        q(
          "6.2",
          "Is there a documented procedures manual (SOPs)?",
          "هل يوجد دليل إجراءات موثق؟",
          "firm_method",
          DD,
          "pp. 13, 26",
        ),
        {
          ref: "6.3",
          prompt: "Can employees easily find the policy or procedure that applies to them? (1 = rarely, 4 = always)",
          promptAr: "هل يسهل على الموظفين الوصول إلى السياسة أو الإجراء الذي يخصهم؟ (1 = نادرًا، 4 = دائمًا)",
          type: "rating",
          basis: "firm_method",
          citation: DD,
          locator: "pp. 25–26",
        },
        {
          ...q(
            "6.4",
            "Is there a written conflict-of-interest policy?",
            "هل توجد سياسة مكتوبة لتعارض المصالح؟",
            "good_practice",
            `${CMA}; ${OECD}; ${MOC}; ${SAMA}`,
            "CMA Art. 41; OECD V.D.7; MoC 2018 ch. 6 (guidance); SAMA Art. 43",
          ),
          legalFor: ["listed_jsc", "bank_or_finance_company"],
          guidanceFor: ["closed_jsc"],
        },
      ],
    },
    {
      title: "Documentation and transparency",
      titleAr: "التوثيق والشفافية",
      questions: [
        q(
          "7.1",
          "Is there a written strategic plan with 3–5 year objectives?",
          "هل توجد خطة استراتيجية مكتوبة بأهداف لثلاث إلى خمس سنوات؟",
          "firm_method",
          DD,
          "pp. 7, 11",
        ),
        q(
          "7.2",
          "Are the strategic objectives linked to KPIs (for example a balanced scorecard)?",
          "هل الأهداف الاستراتيجية مرتبطة بمؤشرات أداء (مثل بطاقة الأداء المتوازن)؟",
          "firm_method",
          `${DD}; Kaplan and Norton, The Balanced Scorecard (listed as reading in the kickoff session)`,
          "DD p. 12; kickoff p. 14",
        ),
        q(
          "7.3",
          "Do owners receive financial and governance information on a fixed schedule?",
          "هل يتلقى الملاك المعلومات المالية ومعلومات الحوكمة بشكل دوري منتظم؟",
          "good_practice",
          OECD,
          "II.A.3; IV.A.1",
        ),
        {
          ...q(
            "7.4",
            "Are dealings with related parties disclosed and approved before they happen?",
            "هل يُفصح عن التعاملات مع الأطراف ذات العلاقة وتُعتمد قبل حدوثها؟",
            "good_practice",
            `${CMA}; ${OECD}; ${SAMA}`,
            "CMA Arts. 40, 41(6) and 28(14); OECD II.F.1 and IV.A.7; SAMA Art. 43(f)",
          ),
          legalFor: ["listed_jsc", "bank_or_finance_company"],
        },
      ],
    },
    {
      title: "Monitoring and implementation of recommendations",
      titleAr: "متابعة تنفيذ التوصيات",
      questions: [
        q(
          "8.1",
          "Does every agreed recommendation have an owner and a target date?",
          "هل لكل توصية متفق عليها مسؤول وتاريخ مستهدف؟",
          "firm_method",
          DD,
          "p. 27",
        ),
        q(
          "8.2",
          "Is progress on recommendations reviewed on a fixed schedule?",
          "هل يُراجع تقدم تنفيذ التوصيات بشكل دوري منتظم؟",
          "firm_method",
          DD,
          "pp. 22, 27",
        ),
        q(
          "8.3",
          "Were the delivered documents (structure, matrix, policies) communicated to the staff they affect?",
          "هل أُبلغ الموظفون المعنيون بالوثائق المسلّمة (الهيكل، المصفوفة، السياسات)؟",
          "firm_method",
          DD,
          "p. 22",
        ),
      ],
    },
  ] satisfies { title: string; titleAr: string; questions: StarterQuestion[] }[],
};

function q(ref: string, prompt: string, promptAr: string, basis: OwnBasis, citation: string, locator: string): StarterQuestion {
  return { ref, prompt, promptAr, type: "yes_no", basis, citation, locator };
}

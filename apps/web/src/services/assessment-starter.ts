import type { OwnBasis, ChoiceOption, LegalForm, QuestionType } from "@/lib/assessments";

// The starter family-governance template: the team's proposed questions,
// not an official assessment of any regulator, publisher or firm. Each one
// names the source it is informed by and where in it; the basis is what it
// is for a non-listed family company, and legalFor/guidanceFor say for which
// legal forms it is binding, or regulator guidance, instead. Source map:
// research thread, 2026-10-21 (docs/assessments.md lists the sources).
//
// Article numbers: the CMA Corporate Governance Regulations were renumbered
// in 2023. Only Art. 16, 41 and 43 are confirmed in the current text; the
// rest is cited by chapter until checked against the official text.

// Citations not yet checked against the source's current text: chapter-level
// references, the Companies Law family charter article, and the MoC rules.
export const UNVERIFIED_CITATIONS = new Set(["2.1", "2.4", "3.3", "3.4", "6.4", "7.3", "7.4"]);

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
const MOC = "Ministry of Commerce governance regulations for non-listed joint stock companies (2018; to verify)";

export const STARTER_TEMPLATE = {
  name: "Family business governance: starter assessment",
  nameAr: "حوكمة الشركات العائلية: تقييم مبدئي",
  description:
    "The team's starter questions across eight governance areas, each informed by a named source. Edit before publishing. Scores are indicative and are not a certification of legal compliance.",
  descriptionAr:
    "أسئلة مبدئية مقترحة من الفريق في ثمانية محاور للحوكمة، كل سؤال مستند إلى مصدر مذكور. عدّلها قبل النشر. النتائج مؤشرات وليست شهادة امتثال نظامي.",
  sections: [
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
        q(
          "2.1",
          "Does the family have a written family charter?",
          "هل لدى العائلة ميثاق عائلي مكتوب؟",
          "good_practice",
          `${IFC}; Companies Law (2022), family charter: binding once adopted, not required`,
          "IFC Sec. II; Companies Law family charter article (reported as Art. 11, to verify)",
        ),
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
          citation: IFC,
          locator: "Sec. II",
        },
        q(
          "2.3",
          "Is there a written policy on employing family members?",
          "هل توجد سياسة مكتوبة لتوظيف أفراد العائلة؟",
          "good_practice",
          IFC,
          "Sec. II",
        ),
        q(
          "2.4",
          "Are the rules for share transfers, exits and profit distribution among family owners written down?",
          "هل قواعد نقل الحصص والتخارج وتوزيع الأرباح بين الملاك من العائلة مكتوبة؟",
          "good_practice",
          `${IFC}; Companies Law (2022), scope of a family charter`,
          "IFC Sec. II",
        ),
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
            `${IFC}; ${CMA}`,
            "IFC Sec. III; CMA Art. 16 (board composition)",
          ),
          guidance:
            'For a listed company, "yes" does not confirm CMA Art. 16: at least two independent directors or one-third of the board, whichever is greater, and a non-executive majority. Check the numbers.',
          guidanceAr:
            "في الشركة المدرجة، الإجابة بنعم لا تؤكد الالتزام بالمادة 16 من لائحة حوكمة الشركات: عضوان مستقلان على الأقل أو ثلث المجلس أيهما أكثر، وأغلبية غير تنفيذية. تحقق من الأعداد.",
          legalFor: ["listed_jsc"],
          appliesIf: { ref: "3.1", values: ["advisory_board", "board"] },
        },
        q(
          "3.3",
          "Are the board's and executive management's responsibilities separated in writing?",
          "هل مسؤوليات المجلس والإدارة التنفيذية مفصولة كتابيًا؟",
          "good_practice",
          `${IFC}; ${OECD}`,
          "IFC Sec. III–IV; OECD chapter on the responsibilities of the board",
        ),
        {
          ...q(
            "3.4",
            "Does the board or management committee meet on a fixed schedule with minutes kept?",
            "هل يجتمع المجلس أو لجنة الإدارة بانتظام وتُحفظ محاضر الاجتماعات؟",
            "good_practice",
            `${IFC}; ${MOC}`,
            "IFC Sec. III; MoC regulations (article to verify)",
          ),
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
        q(
          "5.1",
          "Is there a written succession plan for the CEO and other key roles?",
          "هل توجد خطة تعاقب مكتوبة للرئيس التنفيذي والأدوار الرئيسية؟",
          "good_practice",
          IFC,
          "Sec. IV",
        ),
        q(
          "5.2",
          "Are there agreed rules for preparing the next generation and for how they join the business?",
          "هل توجد قواعد متفق عليها لإعداد الجيل القادم وطريقة انضمامه إلى العمل؟",
          "good_practice",
          IFC,
          "Introduction; Sec. II",
        ),
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
            `${CMA}; ${OECD}`,
            "CMA Art. 41; OECD chapter on the responsibilities of the board",
          ),
          legalFor: ["listed_jsc"],
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
          "Chapter on disclosure and transparency",
        ),
        {
          ...q(
            "7.4",
            "Are dealings with related parties disclosed and approved before they happen?",
            "هل يُفصح عن التعاملات مع الأطراف ذات العلاقة وتُعتمد قبل حدوثها؟",
            "good_practice",
            `${CMA}; ${OECD}`,
            "CMA chapter on conflicts of interest (related-party article to verify); OECD chapter on disclosure",
          ),
          // Not marked binding for listed companies until the CMA article on
          // approving related-party dealings is checked.
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

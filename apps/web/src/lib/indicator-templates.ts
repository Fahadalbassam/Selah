/**
 * Common business indicators a consultant or a client's admin can start
 * from when adding one. A starting point only: every field stays editable,
 * and an indicator of the client's own is just as welcome. Names, units and
 * the way each one reads are the usual ones in finance, customer, people,
 * operations and governance reporting; the baseline, target and source are
 * always the client's.
 */
export type TemplateArea = "finance" | "customers" | "people" | "operations" | "governance";

export interface IndicatorTemplate {
  /** Also the indicator's suggested code for files and systems. */
  key: string;
  area: TemplateArea;
  nameAr: string;
  nameEn: string;
  unit: string;
  direction: "higher_better" | "lower_better";
  frequency: "monthly" | "quarterly";
  definitionAr: string;
  definitionEn: string;
}

export const TEMPLATE_AREAS: TemplateArea[] = ["finance", "customers", "people", "operations", "governance"];

export const INDICATOR_TEMPLATES: IndicatorTemplate[] = [
  // Finance
  { key: "revenue", area: "finance", nameAr: "الإيرادات", nameEn: "Revenue", unit: "SAR", direction: "higher_better", frequency: "monthly",
    definitionAr: "إجمالي الإيرادات المسجلة في الفترة كما في النظام المحاسبي.", definitionEn: "Total revenue booked in the period, as in the accounting system." },
  { key: "gross-margin", area: "finance", nameAr: "هامش الربح الإجمالي", nameEn: "Gross margin", unit: "%", direction: "higher_better", frequency: "monthly",
    definitionAr: "(الإيرادات - تكلفة المبيعات) ÷ الإيرادات.", definitionEn: "(Revenue - cost of sales) ÷ revenue." },
  { key: "operating-expenses", area: "finance", nameAr: "المصروفات التشغيلية", nameEn: "Operating expenses", unit: "SAR", direction: "lower_better", frequency: "monthly",
    definitionAr: "مجموع المصروفات التشغيلية في الفترة.", definitionEn: "Total operating expenses in the period." },
  { key: "receivable-days", area: "finance", nameAr: "أيام تحصيل الذمم المدينة", nameEn: "Days sales outstanding", unit: "days", direction: "lower_better", frequency: "monthly",
    definitionAr: "متوسط عدد الأيام لتحصيل المبالغ من العملاء.", definitionEn: "Average days to collect what customers owe." },
  { key: "days-to-close", area: "finance", nameAr: "أيام إقفال الدفاتر", nameEn: "Days to close the books", unit: "days", direction: "lower_better", frequency: "monthly",
    definitionAr: "عدد أيام العمل من نهاية الشهر حتى اعتماد القوائم الشهرية.", definitionEn: "Working days from month end until the monthly accounts are signed off." },
  { key: "budget-variance", area: "finance", nameAr: "الانحراف عن الميزانية", nameEn: "Budget variance", unit: "%", direction: "lower_better", frequency: "quarterly",
    definitionAr: "الفرق المطلق بين الفعلي والميزانية ÷ الميزانية.", definitionEn: "Absolute difference between actual and budget ÷ budget." },
  // Customers
  { key: "complaints", area: "customers", nameAr: "شكاوى العملاء", nameEn: "Customer complaints", unit: "complaints", direction: "lower_better", frequency: "monthly",
    definitionAr: "عدد الشكاوى المسجلة في الفترة من جميع القنوات.", definitionEn: "Complaints logged in the period, from every channel." },
  { key: "complaint-resolution-days", area: "customers", nameAr: "متوسط أيام حل الشكوى", nameEn: "Average days to resolve a complaint", unit: "days", direction: "lower_better", frequency: "monthly",
    definitionAr: "متوسط الأيام من تسجيل الشكوى حتى إغلاقها.", definitionEn: "Average days from logging a complaint to closing it." },
  { key: "customer-satisfaction", area: "customers", nameAr: "رضا العملاء", nameEn: "Customer satisfaction", unit: "%", direction: "higher_better", frequency: "quarterly",
    definitionAr: "نسبة الراضين أو الراضين جدًا في استبيان الرضا.", definitionEn: "Share of satisfied or very satisfied answers in the satisfaction survey." },
  { key: "customer-retention", area: "customers", nameAr: "الاحتفاظ بالعملاء", nameEn: "Customer retention", unit: "%", direction: "higher_better", frequency: "quarterly",
    definitionAr: "نسبة عملاء بداية الفترة الذين بقوا حتى نهايتها.", definitionEn: "Share of customers at the start of the period still active at its end." },
  // People
  { key: "staff-turnover", area: "people", nameAr: "معدل دوران الموظفين", nameEn: "Staff turnover", unit: "%", direction: "lower_better", frequency: "quarterly",
    definitionAr: "عدد المغادرين ÷ متوسط عدد الموظفين في الفترة.", definitionEn: "Leavers ÷ average headcount in the period." },
  { key: "saudization", area: "people", nameAr: "نسبة التوطين", nameEn: "Saudization rate", unit: "%", direction: "higher_better", frequency: "quarterly",
    definitionAr: "نسبة الموظفين السعوديين كما تحتسبها منصة قوى/نطاقات.", definitionEn: "Share of Saudi employees as calculated by Qiwa/Nitaqat." },
  { key: "time-to-hire", area: "people", nameAr: "أيام شغل الوظيفة", nameEn: "Days to fill a role", unit: "days", direction: "lower_better", frequency: "quarterly",
    definitionAr: "متوسط الأيام من اعتماد الوظيفة حتى قبول العرض.", definitionEn: "Average days from approving a role to an accepted offer." },
  { key: "training-hours", area: "people", nameAr: "ساعات التدريب لكل موظف", nameEn: "Training hours per employee", unit: "hours", direction: "higher_better", frequency: "quarterly",
    definitionAr: "إجمالي ساعات التدريب ÷ عدد الموظفين.", definitionEn: "Total training hours ÷ headcount." },
  { key: "absenteeism", area: "people", nameAr: "نسبة الغياب", nameEn: "Absenteeism", unit: "%", direction: "lower_better", frequency: "monthly",
    definitionAr: "أيام الغياب غير المخطط ÷ أيام العمل المتاحة.", definitionEn: "Unplanned absence days ÷ available working days." },
  // Operations
  { key: "on-time-delivery", area: "operations", nameAr: "التسليم في الموعد", nameEn: "On-time delivery", unit: "%", direction: "higher_better", frequency: "monthly",
    definitionAr: "نسبة الطلبات المسلمة في الموعد المتفق عليه.", definitionEn: "Share of orders delivered by the agreed date." },
  { key: "procurement-cycle-days", area: "operations", nameAr: "أيام دورة الشراء", nameEn: "Procurement cycle days", unit: "days", direction: "lower_better", frequency: "monthly",
    definitionAr: "متوسط الأيام من طلب الشراء حتى أمر الشراء.", definitionEn: "Average days from purchase request to purchase order." },
  { key: "inventory-turnover", area: "operations", nameAr: "معدل دوران المخزون", nameEn: "Inventory turnover", unit: "times", direction: "higher_better", frequency: "quarterly",
    definitionAr: "تكلفة المبيعات ÷ متوسط المخزون.", definitionEn: "Cost of sales ÷ average inventory." },
  { key: "process-sla", area: "operations", nameAr: "الالتزام بمستوى الخدمة", nameEn: "Service level met", unit: "%", direction: "higher_better", frequency: "monthly",
    definitionAr: "نسبة الطلبات المنجزة ضمن المدة المحددة.", definitionEn: "Share of requests completed within the set time." },
  // Governance
  { key: "board-meetings", area: "governance", nameAr: "اجتماعات مجلس الإدارة المنعقدة", nameEn: "Board meetings held", unit: "meetings", direction: "higher_better", frequency: "quarterly",
    definitionAr: "عدد اجتماعات المجلس المنعقدة مقارنة بالخطة.", definitionEn: "Board meetings held in the period, against the plan." },
  { key: "board-decisions-closed", area: "governance", nameAr: "قرارات المجلس المنفذة", nameEn: "Board decisions carried out", unit: "%", direction: "higher_better", frequency: "quarterly",
    definitionAr: "نسبة قرارات المجلس المستحقة التي نُفذت.", definitionEn: "Share of due board decisions that were carried out." },
  { key: "policies-current", area: "governance", nameAr: "السياسات المحدثة", nameEn: "Policies up to date", unit: "%", direction: "higher_better", frequency: "quarterly",
    definitionAr: "نسبة السياسات المعتمدة التي لم يتجاوز موعد مراجعتها.", definitionEn: "Share of approved policies not past their review date." },
  { key: "audit-findings-open", area: "governance", nameAr: "ملاحظات المراجعة المفتوحة", nameEn: "Open audit findings", unit: "findings", direction: "lower_better", frequency: "quarterly",
    definitionAr: "عدد ملاحظات المراجعة الداخلية أو الخارجية غير المغلقة.", definitionEn: "Internal or external audit findings not yet closed." },
  { key: "regulatory-filings-on-time", area: "governance", nameAr: "الإفصاحات النظامية في موعدها", nameEn: "Regulatory filings on time", unit: "%", direction: "higher_better", frequency: "quarterly",
    definitionAr: "نسبة الإفصاحات والتقارير النظامية المقدمة في موعدها.", definitionEn: "Share of regulatory filings and reports submitted on time." },
];

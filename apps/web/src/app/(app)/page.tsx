import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Hourglass } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { dashboard, isOverdue } from "@/services/queries";

// Layout from shadcn/ui block dashboard-01 (section cards + table), fed by
// real records instead of sample data.
export default async function OverviewPage() {
  const { stats, firm } = await withPrincipal(async (tx, principal) => ({
    stats: await dashboard(tx, principal),
    firm: principal.orgKind === "firm",
  }));
  const t = await getTranslations("dashboard");

  const cards = [
    { label: t("inProgress"), hint: t("inProgressHint"), value: stats.inProgress, icon: CircleDashed },
    { label: t("awaitingReview"), hint: t("awaitingReviewHint"), value: stats.awaitingReview, icon: Hourglass },
    { label: t("blocked"), hint: t("blockedHint"), value: stats.blocked, icon: AlertTriangle, tone: "text-destructive" },
    { label: t("verified"), hint: t("verifiedHint"), value: stats.verified, icon: CheckCircle2, tone: "text-success" },
  ];

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardDescription className="flex items-center gap-2">
                <c.icon className={cn("size-4", c.tone)} />
                {c.label}
              </CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">{c.value}</CardTitle>
            </CardHeader>
            <CardFooter className="px-5 text-xs text-muted-foreground">{c.hint}</CardFooter>
          </Card>
        ))}
      </div>
      {stats.overdue > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <Clock className="size-4" />
          {t("overdue")}: <span className="font-semibold tabular-nums">{stats.overdue}</span>
        </div>
      ) : null}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{firm ? t("attentionFirm") : t("attentionClient")}</h2>
        <ActionsTable rows={stats.attention.map((r) => ({ ...r, overdue: isOverdue(r) }))} empty={t("empty")} />
      </section>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("claimNote")}</p>
    </>
  );
}

import { getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { AnimatedNumber } from "@/components/animated-number";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { Clock } from "@/components/animate-ui/icons/clock";
import { Hourglass } from "@/components/animate-ui/icons/hourglass";
import { LoaderCircle } from "@/components/animate-ui/icons/loader-circle";
import { TriangleAlert } from "@/components/animate-ui/icons/triangle-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { dashboard, isOverdue } from "@/services/queries";
import { SectionHeader } from "@/components/section-header";

// Layout from shadcn/ui block dashboard-01 (section cards + table), fed by
// real records instead of sample data.
export default async function OverviewPage() {
  const { stats, firm } = await withPrincipal(async (tx, principal) => ({
    stats: await dashboard(tx, principal),
    firm: principal.orgKind === "firm",
  }));
  const t = await getTranslations("dashboard");

  const cards = [
    { label: t("inProgress"), hint: t("inProgressHint"), value: stats.inProgress, icon: LoaderCircle },
    { label: t("awaitingReview"), hint: t("awaitingReviewHint"), value: stats.awaitingReview, icon: Hourglass },
    { label: t("blocked"), hint: t("blockedHint"), value: stats.blocked, icon: TriangleAlert, tone: "text-destructive" },
    { label: t("verified"), hint: t("verifiedHint"), value: stats.verified, icon: CircleCheck, tone: "text-success" },
  ];

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="group gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardDescription className="flex items-center gap-2">
                <c.icon animateOnView animateOnHover className={cn("size-4", c.tone)} />
                {c.label}
              </CardDescription>
              <CardTitle className="text-3xl font-semibold">
                <AnimatedNumber value={c.value} />
              </CardTitle>
            </CardHeader>
            <CardFooter className="px-5 text-xs text-muted-foreground">{c.hint}</CardFooter>
          </Card>
        ))}
      </div>
      {/* Full-strength text: at /90 on the tinted background it was 4.36:1, under AA. */}
      {stats.overdue > 0 ? (
        <Alert
          variant="destructive"
          className="animate-page-in border-destructive/30 bg-destructive/5 *:data-[slot=alert-description]:text-destructive"
        >
          <Clock animateOnView />
          <AlertDescription>
            <span>
              {t("overdue")}: <span className="font-semibold tabular-nums">{stats.overdue}</span>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      <section className="space-y-3">
        <SectionHeader title={firm ? t("attentionFirm") : t("attentionClient")} />
        <ActionsTable rows={stats.attention.map((r) => ({ ...r, overdue: isOverdue(r) }))} empty={t("empty")} />
      </section>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("claimNote")}</p>
    </>
  );
}

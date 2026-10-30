import { getLocale, getTranslations } from "next-intl/server";
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
import { dashboard, getViewer, isOverdue } from "@/services/queries";
import { isNewcomer } from "@/services/consent";
import { Welcome } from "@/components/welcome";
import type { Role } from "@/authz";
import { SectionHeader } from "@/components/section-header";
import { ClientProgress } from "@/components/client-progress";
import { clientOverview } from "@/services/client-overview";
import { IndicatorsCard } from "@/components/indicators/indicators-card";
import { listIndicators } from "@/services/indicators";
import { dataSettings } from "@/services/indicator-data";
import { DataSetupCard } from "@/components/indicators/data-mode-picker";

const WELCOME_DAYS = 14;
// Where each role's three welcome steps lead, in the order of messages welcome.steps.<role>.
const WELCOME_LINKS: Record<Role, [string, string, string]> = {
  firm_admin: ["/clients", "/team", "/settings"],
  consultant: ["/today", "/projects", "/review"],
  client_admin: ["/projects", "/team", "/help"],
  client_manager: ["/actions", "/projects", "/help"],
  action_owner: ["/actions", "/actions", "/help"],
};

/** The first name in the page's language: the other-language name when the stored one is in the other script. */
function firstName(v: { name: string; nameAlt: string | null }, locale: string) {
  const arabic = /[\u0600-\u06FF]/.test(v.name);
  const name = v.nameAlt && arabic !== (locale === "ar") ? v.nameAlt : v.name;
  return name.split(" ")[0] ?? name;
}

// Layout from shadcn/ui block dashboard-01 (section cards + table), fed by
// real records instead of sample data.
export default async function OverviewPage() {
  const { stats, firm, overview, indicators, viewer, isNew, dataSetup } = await withPrincipal(async (tx, principal) => ({
    stats: await dashboard(tx, principal),
    firm: principal.orgKind === "firm",
    viewer: await getViewer(tx, principal),
    // New people (two weeks from their first sign-in) get a short welcome with three places to start.
    isNew: await isNewcomer(tx, principal, WELCOME_DAYS),
    // The client's admins and managers see their work across projects (F30).
    overview:
      principal.role === "client_admin" || principal.role === "client_manager"
        ? await clientOverview(tx, principal, principal.orgId).catch(() => null)
        : null,
    // Beside it, the business indicators they report (KPI layer B).
    indicators:
      principal.role === "client_admin" || principal.role === "client_manager"
        ? await listIndicators(tx, principal, principal.orgId, { includeInactive: true }).catch(() => null)
        : null,
    // A client's admin who has not yet said how its figures reach Selah sees a short, skippable setup step.
    dataSetup: principal.role === "client_admin" ? await dataSettings(tx, principal, principal.orgId).catch(() => null) : null,
  }));
  const [t, tW, tD, locale] = await Promise.all([getTranslations("dashboard"), getTranslations("welcome"), getTranslations("indicatorData"), getLocale()]);
  const side = firm ? "firm" : "client";
  const [before, after] = tW.raw(`intro.${side}`).split("{highlight}") as [string, string];

  const cards = [
    { label: t("inProgress"), hint: t("inProgressHint"), value: stats.inProgress, icon: LoaderCircle },
    { label: t("awaitingReview"), hint: t("awaitingReviewHint"), value: stats.awaitingReview, icon: Hourglass },
    { label: t("blocked"), hint: t("blockedHint"), value: stats.blocked, icon: TriangleAlert, tone: "text-destructive" },
    { label: t("verified"), hint: t("verifiedHint"), value: stats.verified, icon: CircleCheck, tone: "text-success" },
  ];

  return (
    <>
      <PageHeader title={t("title")} />
      {isNew ? (
        <Welcome
          greeting={tW("greeting", { name: firstName(viewer, locale) })}
          intro={[before, after]}
          highlight={tW(`highlight.${side}`)}
          lead={tW("lead")}
          steps={(tW.raw(`steps.${viewer.role}`) as { title: string; hint: string }[]).map((s, i) => ({ ...s, href: WELCOME_LINKS[viewer.role][i] ?? "/" }))}
          dismissLabel={tW("dismiss")}
          dir={locale === "ar" ? "rtl" : "ltr"}
        />
      ) : null}
      {dataSetup && !dataSetup.chosen && dataSetup.canChoose ? (
        <DataSetupCard
          title={tD("setup.title")}
          hint={tD("setup.hint")}
          clientId={dataSetup.client.id}
          proposal={dataSetup.proposal ? { mode: dataSetup.proposal.mode, by: dataSetup.proposal.by } : null}
        />
      ) : null}
      <div className="stagger grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="group gap-3 bg-surface py-5 text-surface-foreground shadow-xs">
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
      {overview && overview.projects.length ? <ClientProgress data={overview} tiles={false} /> : null}
      {indicators && (indicators.indicators.length || indicators.canManage) ? <IndicatorsCard data={indicators} /> : null}
      <section className="space-y-3">
        <SectionHeader title={firm ? t("attentionFirm") : t("attentionClient")} />
        <ActionsTable rows={stats.attention.map((r) => ({ ...r, overdue: isOverdue(r) }))} empty={t("empty")} />
      </section>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("claimNote")}</p>
    </>
  );
}

import { ArrowLeft } from "lucide-react";
import { Crown } from "@/components/animate-ui/icons/crown";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { ClientProgress } from "@/components/client-progress";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge } from "@/components/tone-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { localLabel, localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { departmentOverview } from "@/services/client-overview";
import { IndicatorsCard } from "@/components/indicators/indicators-card";
import { listIndicators } from "@/services/indicators";

// One department's page (F31): its numbers across the client's projects,
// who is in it, and its open actions. The scope is the department, and the
// page says whose department it is.
export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => {
    const overview = await departmentOverview(tx, principal, id).catch(() => null);
    return {
      firm: principal.orgKind === "firm",
      overview,
      // The department's own business indicators (KPI layer B).
      indicators: overview
        ? await listIndicators(tx, principal, overview.client.id, { departmentId: id, includeInactive: true }).catch(() => null)
        : null,
    };
  });
  if (!data.overview) notFound();
  const { overview, firm, indicators } = data;
  const [t, tc] = await Promise.all([getTranslations("departmentPage"), getTranslations("engagement.departments")]);
  const ar = (await getLocale()) === "ar";
  const dept = overview.department;
  const other = ar ? dept.nameEn : dept.nameEn ? dept.nameAr : null;
  const back = firm ? `/clients/${overview.client.id}/departments` : "/departments";

  return (
    <>
      <Link href={back} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {firm ? t("backFirm", { client: localName(overview.client, ar) }) : tc("title")}
      </Link>
      <PageHeader
        title={localLabel(dept, ar)}
        description={[other, firm ? localName(overview.client, ar) : null].filter(Boolean).join(" · ") || undefined}
        meta={dept.active ? undefined : <ToneBadge tone="neutral">{tc("switchedOff")}</ToneBadge>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ClientProgress data={overview} scope="department" />
        <Card className="h-fit gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("people")}</CardTitle>
            <CardDescription>{t("peopleHint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            {overview.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tc("noMembers")}</p>
            ) : (
              <ul className="divide-y">
                {overview.members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium">
                      {m.name}
                    </span>
                    {m.isHead ? (
                      <ToneBadge tone="active" className="gap-1">
                        <Crown className="size-3" />
                        {tc("head")}
                      </ToneBadge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {indicators && (indicators.indicators.length || indicators.canManage) ? (
        <IndicatorsCard data={indicators} scope="department" departmentId={id} />
      ) : null}
      <section className="space-y-3">
        <SectionHeader title={t("openTitle")} description={t("openHint")} />
        <ActionsTable rows={overview.open} empty={t("openEmpty")} />
      </section>
    </>
  );
}

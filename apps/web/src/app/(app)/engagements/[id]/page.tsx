import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Plus } from "@/components/animate-ui/icons/plus";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { CoverDialog, EngagementDialog } from "@/components/engagement-form";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NOT_COVERED } from "@/lib/engagements";
import { isUuid } from "@/lib/ids";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { getEngagement } from "@/services/engagements";

/** One signed engagement: what was agreed, the projects it covers and what it delivers. */
export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, firm } = await withPrincipal(async (tx, principal) => ({
    data: await getEngagement(tx, principal, id),
    firm: principal.orgKind === "firm",
  }));
  const [t, tPh, format, locale] = await Promise.all([getTranslations("engagements"), getTranslations("phases"), getFormatter(), getLocale()]);
  const { engagement: g, client, can } = data;
  const day = (d: string | null) => (d ? format.dateTime(new Date(d), { dateStyle: "medium" }) : null);
  const facts: [string, string | null][] = [
    [t("detail.signedOn"), day(g.signedOn)],
    [t("detail.contractRef"), g.contractRef],
    [
      t("period"),
      g.startsOn || g.endsOn
        ? format.dateTimeRange(new Date(g.startsOn ?? g.endsOn!), new Date(g.endsOn ?? g.startsOn!), { dateStyle: "medium" })
        : null,
    ],
    [t("detail.dataAgreement"), g.dataAgreementOn ? t("signedOnShort", { date: day(g.dataAgreementOn)! }) : t("noDataAgreement")],
    [t("afterwards"), g.retainerFollows ? t("retainer") : t("noRetainer")],
  ];
  const title = (p: { sequence: number | null; title: string }) => (p.sequence ? tPh("numbered", { n: p.sequence, title: p.title }) : p.title);

  return (
    <>
      <Link
        href={firm ? `/clients/${client.id}` : "/"}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {localName(client, locale === "ar")}
      </Link>
      <PageHeader title={g.title} description={t("pageHint")}>
        {can.edit ? (
          <EngagementDialog
            trigger={
              <Button size="sm" variant="outline">
                <Pencil />
                {t("edit")}
              </Button>
            }
            endpoint={`/api/engagements/${g.id}`}
            method="PATCH"
            values={g}
          />
        ) : null}
        {can.delete ? (
          <ApiButton
            endpoint={`/api/engagements/${g.id}`}
            method="DELETE"
            label={t("delete")}
            icon={<Trash2 />}
            variant="ghost"
            confirm={t("deleteConfirm")}
            redirectTo={`/clients/${client.id}`}
          />
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("fields.scope")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-5 text-sm">
              <p className="whitespace-pre-wrap" dir="auto">
                {g.scope}
              </p>
              {g.exclusions ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{t("fields.exclusions")}</p>
                  <p className="whitespace-pre-wrap" dir="auto">
                    {g.exclusions}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("coveredProjects")}</CardTitle>
                <CardDescription>{t("coveredHint")}</CardDescription>
              </div>
              {can.edit && data.drafts.length ? (
                <CoverDialog
                  endpoint={`/api/engagements/${g.id}/projects`}
                  drafts={data.drafts}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Plus />
                      {t("cover")}
                    </Button>
                  }
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-5">
              {data.projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("coversNone")}</p>
              ) : (
                <ul className="divide-y">
                  {data.projects.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-3 text-sm">
                      <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 font-medium hover:underline" dir="auto">
                        {title(p)}
                      </Link>
                      <ToneBadge tone={p.state === "active" ? "active" : p.state === "closed" ? "neutral" : "open"}>{tPh(`states.${p.state}`)}</ToneBadge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("deliverables")}</CardTitle>
                <CardDescription>{t("deliverablesHint")}</CardDescription>
              </div>
              {can.edit ? (
                <FormDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      <Plus />
                      {t("addDeliverable")}
                    </Button>
                  }
                  title={t("addDeliverable")}
                  description={t("deliverablesHint")}
                  endpoint={`/api/engagements/${g.id}/deliverables`}
                  fields={[
                    { name: "title", label: t("deliverable.title"), required: true, maxLength: 300, placeholder: t("deliverable.titlePlaceholder") },
                    { name: "acceptanceCriteria", label: t("deliverable.criteria"), type: "textarea", maxLength: 2000 },
                    { name: "dueOn", label: t("deliverable.dueOn"), type: "date", placeholder: t("deliverable.dueOn") },
                    ...(data.projects.length
                      ? [
                          {
                            name: "projectId",
                            label: t("deliverable.project"),
                            type: "select" as const,
                            options: [{ value: NOT_COVERED, label: t("deliverable.anyProject") }, ...data.projects.map((p) => ({ value: p.id, label: title(p) }))],
                          },
                        ]
                      : []),
                  ]}
                  submitLabel={t("addDeliverable")}
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-5">
              {data.deliverables.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noDeliverables")}</p>
              ) : (
                <ul className="divide-y">
                  {data.deliverables.map((d) => {
                    const project = d.projectId ? data.projects.find((p) => p.id === d.projectId) : null;
                    return (
                      <li key={d.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-medium" dir="auto">
                            {d.title}
                          </p>
                          {d.acceptanceCriteria ? (
                            <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
                              {d.acceptanceCriteria}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            {[d.dueOn ? t("dueOn", { date: day(d.dueOn)! }) : t("noDue"), project ? title(project) : null].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        {can.edit ? (
                          <ApiButton
                            endpoint={`/api/engagements/${g.id}/deliverables/${d.id}`}
                            method="DELETE"
                            label={t("removeDeliverable")}
                            variant="ghost"
                            confirm={t("removeDeliverableConfirm")}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("details")}</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <dl className="grid gap-3 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums" dir="auto">
                    {value ?? "—"}
                  </dd>
                </div>
              ))}
              {data.inquiry ? (
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">{t("fromInquiry")}</dt>
                  <dd>
                    <Link href={`/inquiries/${data.inquiry.id}`} className="hover:underline" dir="ltr">
                      {data.inquiry.publicRef}
                    </Link>
                  </dd>
                </div>
              ) : null}
              {firm ? (
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">{t("recorded")}</dt>
                  <dd>
                    {[g.recordedBy, format.dateTime(new Date(g.createdAt), { dateStyle: "medium" })].filter(Boolean).join(" · ")}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

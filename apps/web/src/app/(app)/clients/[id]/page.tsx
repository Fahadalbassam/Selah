import { ArrowLeft, Crown, Eye, EyeOff, Pencil, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LEGAL_FORMS } from "@/lib/assessments";
import { withPrincipal } from "@/server/page";
import { getClientTeam } from "@/services/staffing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => (principal.orgKind === "firm" ? await getClientTeam(tx, principal, id) : null));
  if (!data) notFound();
  const [t, tc, tq, format] = await Promise.all([
    getTranslations("staffing"),
    getTranslations("clients"),
    getTranslations("assessment.question"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { client, can } = data;

  return (
    <>
      <Link href="/clients" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {tc("title")}
      </Link>
      <PageHeader title={(ar ? client.nameAr : null) ?? client.name} description={ar ? client.name : (client.nameAr ?? undefined)}>
        {can.watch ? (
          <ApiButton
            endpoint={`/api/clients/${client.id}/watch`}
            method="PUT"
            body={{ on: !data.watching }}
            label={data.watching ? t("unwatch") : t("watch")}
            icon={data.watching ? <EyeOff /> : <Eye />}
            title={t("watchClientHint")}
          />
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("teamTitle")}</CardTitle>
                <CardDescription>{t("teamHint")}</CardDescription>
              </div>
              {can.manage ? (
                data.candidates.length ? (
                  <FormDialog
                    trigger={
                      <Button size="sm">
                        <UserPlus />
                        {t("addConsultant")}
                      </Button>
                    }
                    title={t("addConsultant")}
                    description={t("addConsultantHint")}
                    endpoint={`/api/clients/${client.id}/consultants`}
                    fields={[
                      {
                        name: "userId",
                        label: t("consultant"),
                        type: "select",
                        required: true,
                        options: data.candidates.map((c) => ({ value: c.userId, label: `${c.name} · ${c.email}` })),
                      },
                    ]}
                    submitLabel={t("add")}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{t("noCandidates")}</span>
                )
              ) : null}
            </CardHeader>
            <CardContent className="divide-y px-5">
              {data.team.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t("noLead")}</p> : null}
              {data.team.map((m) => (
                <div key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {m.name}
                      {m.isLead ? (
                        <Badge variant="outline" className="gap-1 border-transparent bg-accent text-accent-foreground">
                          <Crown className="size-3" />
                          {t("leadBadge")}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.email} · {t("since", { date: format.dateTime(m.since, { dateStyle: "medium" }) })}
                    </p>
                  </div>
                  {can.setLead && !m.isLead ? (
                    <ApiButton endpoint={`/api/clients/${client.id}/lead`} method="PUT" body={{ userId: m.userId }} label={t("makeLead")} variant="ghost" />
                  ) : null}
                  {can.manage && (!m.isLead || can.setLead) ? (
                    <ApiButton
                      endpoint={`/api/clients/${client.id}/consultants/${m.userId}`}
                      method="DELETE"
                      label={t("remove")}
                      variant="ghost"
                      confirm={t("removeConfirm")}
                    />
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          {can.decide ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("joinRequests")}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y px-5">
                {data.requests.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRequests")}</p> : null}
                {data.requests.map((r) => (
                  <div key={r.id} className="space-y-2 py-3">
                    <p className="text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="ms-2 text-xs text-muted-foreground">
                        {r.email} · {format.dateTime(r.createdAt, { dateStyle: "medium" })}
                      </span>
                    </p>
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">{r.reason}</p>
                    <div className="flex gap-2">
                      <ApiButton endpoint={`/api/join-requests/${r.id}/decision`} body={{ approve: true }} label={t("approve")} variant="default" />
                      <ApiButton endpoint={`/api/join-requests/${r.id}/decision`} body={{ approve: false }} label={t("decline")} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
        <Card className="h-fit gap-4 py-5 shadow-xs">
          <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
            <div className="space-y-1.5">
              <CardTitle className="text-base">{tq("legalFormTitle")}</CardTitle>
              <CardDescription>{tq("legalFormHint")}</CardDescription>
            </div>
            {can.setLegalForm ? (
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    <Pencil />
                    {tq("change")}
                  </Button>
                }
                title={tq("legalFormTitle")}
                description={tq("legalFormHint")}
                endpoint={`/api/orgs/${client.id}/legal-form`}
                method="PUT"
                fields={[
                  {
                    name: "legalForm",
                    label: tq("legalFormTitle"),
                    type: "select",
                    required: true,
                    defaultValue: client.legalForm ?? undefined,
                    options: LEGAL_FORMS.map((f) => ({ value: f, label: tq(`forms.${f}`) })),
                  },
                ]}
                submitLabel={tq("save")}
              />
            ) : null}
          </CardHeader>
          <CardContent className="px-5 text-sm">
            {client.legalForm ? tq(`forms.${client.legalForm}`) : <span className="text-muted-foreground">{tq("notRecorded")}</span>}
          </CardContent>
        </Card>
        <Card className="h-fit gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("clientProjects")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5">
            {data.projects.length === 0 ? <p className="text-sm text-muted-foreground">{t("noProjects")}</p> : null}
            {data.projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="block rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                {p.title}
              </Link>
            ))}
          </CardContent>
        </Card>
        </div>
      </div>
    </>
  );
}

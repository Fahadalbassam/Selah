import { ArrowLeft, Building, Pencil, Trash2 } from "lucide-react";
import { Plus } from "@/components/animate-ui/icons/plus";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { GroupProgress } from "@/components/group-progress";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { localLabel, localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { groupOverview } from "@/services/client-groups";

// One holding group for firm staff (F34): its pooled counts with a row per
// member company, and (for the firm admin) its members: linked clients, and
// the companies kept inside each of them.
export default async function ClientGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal((tx, principal) => groupOverview(tx, principal, id));
  const [t, tOff, tq] = await Promise.all([getTranslations("clientGroups"), getTranslations("offboarding"), getTranslations("common")]);
  const ar = (await getLocale()) === "ar";
  const { group, can } = data;
  const base = `/api/client-groups/${group.id}`;

  return (
    <>
      <Link href="/clients/groups" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("title")}
      </Link>
      <PageHeader title={localLabel(group, ar)} description={ar ? (group.nameEn ?? undefined) : group.nameEn ? group.nameAr : undefined}>
        {can.manage ? (
          <>
            <FormDialog
              trigger={
                <Button variant="outline">
                  <Pencil />
                  {t("edit")}
                </Button>
              }
              title={t("editTitle")}
              endpoint={base}
              method="PATCH"
              sendEmptyAsNull
              fields={[
                { name: "nameAr", label: t("nameAr"), required: true, maxLength: 200, dir: "rtl", defaultValue: group.nameAr },
                { name: "nameEn", label: t("nameEn"), maxLength: 200, dir: "ltr", defaultValue: group.nameEn ?? "" },
                { name: "notes", label: t("notes"), type: "textarea", maxLength: 2000, defaultValue: group.notes ?? "" },
              ]}
              submitLabel={tq("save")}
            />
            <ApiButton
              endpoint={base}
              method="DELETE"
              label={t("delete")}
              icon={<Trash2 />}
              variant="ghost"
              size="default"
              confirm={t("deleteConfirm")}
              redirectTo="/clients/groups"
            />
          </>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <GroupProgress total={data.total} companies={data.companies} links />

        <div className="space-y-6">
          <Card className="h-fit gap-3 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("membersTitle")}</CardTitle>
                <CardDescription>{can.manage ? t("membersHint") : t("membersHintConsultant")}</CardDescription>
              </div>
              {can.manage && data.candidates.length ? (
                <FormDialog
                  trigger={
                    <Button size="sm">
                      <Plus />
                      {t("addMember")}
                    </Button>
                  }
                  title={t("addMember")}
                  description={t("addMemberHint")}
                  endpoint={`${base}/members`}
                  fields={[
                    {
                      name: "clientOrgId",
                      label: t("client"),
                      type: "select",
                      required: true,
                      options: data.candidates.map((c) => ({ value: c.id, label: localName(c, ar) })),
                    },
                  ]}
                  submitLabel={t("link")}
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-5">
              {data.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
              ) : (
                <ul className="divide-y">
                  {data.members.map((m) => (
                    <li key={m.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/clients/${m.id}`} className="min-w-0 flex-1 text-sm font-medium hover:underline">
                          {localName(m, ar)}
                        </Link>
                        {m.status === "archived" ? <ToneBadge tone="neutral">{tOff("archived")}</ToneBadge> : null}
                        {can.manage ? (
                          <ApiButton
                            endpoint={`${base}/members/${m.id}`}
                            method="DELETE"
                            label={t("removeMember")}
                            variant="ghost"
                            confirm={t("removeMemberConfirm", { client: localName(m, ar) })}
                          />
                        ) : null}
                      </div>
                      {m.units.length ? (
                        <ul className="space-y-1 ps-3">
                          {m.units.map((u) => (
                            <li key={u.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Building className="size-3.5 shrink-0" />
                              <span className="min-w-0 flex-1">{localLabel(u, ar)}</span>
                              {can.manage ? (
                                <ApiButton
                                  endpoint={`${base}/companies/${u.id}`}
                                  method="DELETE"
                                  label={t("unmark")}
                                  variant="ghost"
                                  confirm={t("unmarkConfirm", { name: localLabel(u, ar) })}
                                />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {can.manage && m.departments.length ? (
                        <FormDialog
                          trigger={
                            <Button size="sm" variant="outline">
                              <Building />
                              {t("markCompany")}
                            </Button>
                          }
                          title={t("markCompanyTitle", { client: localName(m, ar) })}
                          description={t("markCompanyHint")}
                          endpoint={`${base}/companies/:departmentId`}
                          method="PUT"
                          fields={[
                            {
                              name: "departmentId",
                              label: t("department"),
                              type: "select",
                              required: true,
                              options: m.departments.map((d) => ({ value: d.id, label: localLabel(d, ar) })),
                            },
                          ]}
                          submitLabel={t("mark")}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {group.notes ? (
            <Card className="h-fit gap-3 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("notesTitle")}</CardTitle>
                <CardDescription>{t("notesHint")}</CardDescription>
              </CardHeader>
              <CardContent className="px-5">
                <p className="text-sm whitespace-pre-line" dir="auto">
                  {group.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { getProjectPeople } from "@/services/staffing";

type People = NonNullable<Awaited<ReturnType<typeof getProjectPeople>>>;

/**
 * The client's own people on a client project, for the firm and the
 * client's admin. Managers and action owners see only the projects they are
 * on, and an action's owner must be on its project. What it offers follows
 * the client's mode: a consultant-managed client has no accounts.
 */
export async function ProjectPeople({ projectId, clientId, firm, data }: { projectId: string; clientId: string; firm: boolean; data: People }) {
  const [t, tRole] = await Promise.all([getTranslations("projectPeople"), getTranslations("role")]);
  const managed = data.mode === "consultant_managed";
  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t(`hint.${data.mode}`)}</CardDescription>
        </div>
        {data.can.manage && !managed ? (
          data.candidates.length ? (
            <FormDialog
              trigger={
                <Button size="sm">
                  <UserPlus />
                  {t("add")}
                </Button>
              }
              title={t("add")}
              description={t("addHint")}
              endpoint={`/api/projects/${projectId}/people`}
              fields={[
                {
                  name: "userId",
                  label: t("person"),
                  type: "select",
                  required: true,
                  options: data.candidates.map((c) => ({ value: c.userId, label: `${c.name} · ${tRole(c.role)} · ${c.email}` })),
                },
              ]}
              submitLabel={t("addButton")}
            />
          ) : (
            <span className="text-xs text-muted-foreground">{t("noCandidates")}</span>
          )
        ) : null}
      </CardHeader>
      <CardContent className="divide-y px-5">
        {managed ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t("managed")}{" "}
            {firm ? (
              <Link href={`/clients/${clientId}`} className="underline underline-offset-4 hover:text-foreground">
                {t("contactsLink")}
              </Link>
            ) : null}
          </p>
        ) : data.people.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("none")}</p>
        ) : null}
        {data.people.map((m) => (
          <div key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground">
                {tRole(m.role)} · <bdi dir="ltr">{m.email}</bdi>
                {m.active ? null : ` · ${t("switchedOff")}`}
                {m.openActions ? ` · ${t("owns", { n: m.openActions })}` : null}
              </p>
            </div>
            {data.can.manage ? (
              m.openActions ? (
                <span className="text-xs text-muted-foreground">{t("reassignFirst")}</span>
              ) : (
                <ApiButton
                  endpoint={`/api/projects/${projectId}/people/${m.userId}`}
                  method="DELETE"
                  label={t("remove")}
                  variant="ghost"
                  confirm={t("removeConfirm", { name: m.name })}
                />
              )
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FormDialog } from "@/components/form-dialog";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OwnerControl } from "@/services/action-owner";
import { ReassignActions } from "./reassign-actions";
import type { getProjectPeople } from "@/services/staffing";
import { RemoveFromProject } from "./project-menu";

type People = NonNullable<Awaited<ReturnType<typeof getProjectPeople>>>;

/**
 * The client's own people on a client project, for the firm and the
 * client's admin. Managers and action owners see only the projects they are
 * on, and an action's owner must be on its project. What it offers follows
 * the client's mode: a consultant-managed client has no accounts.
 */
export async function ProjectPeople({
  projectId,
  clientId,
  firm,
  data,
  primary = true,
  reassign = {},
}: {
  projectId: string;
  clientId: string;
  firm: boolean;
  data: People;
  /** Its add button is the tab's one solid button only when the firm's staffing card is not there (the screen standard). */
  primary?: boolean;
  /** Each person's open actions here that the reader may give to a colleague (review S3). */
  reassign?: Record<string, { id: string; title: string; control: OwnerControl }[]>;
}) {
  // A client reader's own roles in their own words ("Admin", not "Client admin").
  const [t, tRole, tTip] = await Promise.all([getTranslations("projectPeople"), getTranslations(firm ? "role" : "roleClient"), getTranslations("tips")]);
  const managed = data.mode === "consultant_managed";
  // The client's admin reads about "your people", never "the client's people" (page audit 4.7).
  const own = firm ? "" : "Client";
  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t(`title${own}`)}</CardTitle>
          <CardDescription>{t(`hint${own}.${data.mode}`)}</CardDescription>
        </div>
        {data.can.manage && !managed ? (
          data.candidates.length ? (
            <FormDialog
              trigger={
                <Button size="sm" variant={primary ? "default" : "outline"}>
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
                  type: "person",
                  required: true,
                  options: data.candidates.map((c) => ({ value: c.userId, label: c.name, hint: `${tRole(c.role)} · ${c.email}` })),
                },
              ]}
              submitLabel={t("addButton")}
            />
          ) : (
            <span className="text-xs text-muted-foreground">{t(`noCandidates${own}`)}</span>
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
          <p className="py-2 text-sm text-muted-foreground">{t(`none${own}`)}</p>
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
                // Their actions on this project, each with its own owner control (review S3; D1), for whoever may reassign them.
                reassign[m.userId]?.length ? (
                  <ReassignActions name={m.name} actions={reassign[m.userId]!} firm={firm} />
                ) : (
                  <Hint tip={tTip("people.reassignFirst")} className="text-xs text-muted-foreground">
                    {t("reassignFirst")}
                  </Hint>
                )
              ) : (
                <RemoveFromProject name={m.name} endpoint={`/api/projects/${projectId}/people/${m.userId}`} confirm={t(`removeConfirm${own}`, { name: m.name })} />
              )
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

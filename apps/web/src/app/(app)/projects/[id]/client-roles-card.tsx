import { UserPlus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CLIENT_ROLES_ORDER, type ClientRoleName } from "@/lib/client-roles";
import type { listClientRoles } from "@/services/client-roles";

type Data = NonNullable<Awaited<ReturnType<typeof listClientRoles>>>;

/** Who is who on the client's side: sponsor, coordinator, steering committee, acceptors, observers. */
export async function ClientRolesCard({ projectId, data }: { projectId: string; data: Data }) {
  const t = await getTranslations("clientRoles");
  const byRole = (role: ClientRoleName) => data.roles.filter((r) => r.role === role);
  const options = [
    ...data.people.map((p) => ({ value: `user:${p.id}`, label: t("optionAccount", { name: p.name }) })),
    ...data.contacts.map((c) => ({ value: `contact:${c.id}`, label: t("optionContact", { name: c.name }) })),
  ];

  return (
    <Card className="gap-4 py-5 shadow-xs lg:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("hint")}</CardDescription>
        </div>
        {data.can.manage && options.length ? (
          <FormDialog
            trigger={
              <Button size="sm" variant="outline">
                <UserPlus />
                {t("name")}
              </Button>
            }
            title={t("name")}
            description={data.can.contacts ? t("nameHint") : t("nameHintClient")}
            endpoint={`/api/projects/${projectId}/client-roles`}
            fields={[
              {
                name: "role",
                label: t("role"),
                type: "select",
                required: true,
                options: CLIENT_ROLES_ORDER.map((r) => ({ value: r, label: t(`roles.${r}`) })),
              },
              { name: "person", label: t("person"), type: "select", required: true, options },
            ]}
            submitLabel={t("nameButton")}
          />
        ) : null}
      </CardHeader>
      <CardContent className="px-5">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {CLIENT_ROLES_ORDER.map((role) => {
            const held = byRole(role);
            return (
              <div key={role} className="space-y-1">
                <dt className="text-xs text-muted-foreground" title={t(`about.${role}`)}>
                  {t(`roles.${role}`)}
                </dt>
                {held.length === 0 ? <dd className="text-sm text-muted-foreground">{t("nobody")}</dd> : null}
                {held.map((r) => (
                  <dd key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span dir="auto" className="font-medium">
                      {r.name}
                    </span>
                    {r.contactId ? <ToneBadge tone="neutral">{t("contact")}</ToneBadge> : null}
                    {r.active ? null : <ToneBadge tone="problem">{t("accountOff")}</ToneBadge>}
                    {r.title ? (
                      <span dir="auto" className="text-xs text-muted-foreground">
                        {r.title}
                      </span>
                    ) : null}
                    {data.can.manage && (data.can.contacts || !r.contactId) ? (
                      <ApiButton
                        endpoint={`/api/projects/${projectId}/client-roles/${r.id}`}
                        method="DELETE"
                        label={t("remove")}
                        variant="ghost"
                        size="sm"
                        confirm={t("removeConfirm", { name: r.name, role: t(`roles.${role}`) })}
                      />
                    ) : null}
                  </dd>
                ))}
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}

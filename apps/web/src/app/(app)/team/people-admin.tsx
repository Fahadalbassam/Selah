import { UserPlus } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { listPeople } from "@/services/accounts";
import { AccessReview, DomainsDialog, PersonMenu } from "./people-panels";

type People = Awaited<ReturnType<typeof listPeople>>;

const ROLES = {
  firm: ["consultant", "firm_admin"],
  full: ["action_owner", "client_manager", "client_admin"],
  restricted: ["client_admin"],
  consultant_managed: [],
} as const;

/**
 * An organisation's accounts for its admin: invite, open invitations, each
 * person's status and what can be done to them, email domains and the access
 * review. The firm admin uses it for the firm and for each client.
 */
export async function PeopleAdmin({
  data,
  me,
  myRole,
  reviewDays,
}: {
  data: People;
  me: string;
  myRole: string;
  reviewDays: number | null;
}) {
  const [t, tRole, format] = await Promise.all([getTranslations("people"), getTranslations("role"), getFormatter()]);
  const ar = (await getLocale()) === "ar";
  const org = data.organization;
  const firm = org.kind === "firm";
  const roles = firm ? ROLES.firm : ROLES[org.engagementMode ?? "full"];
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const active = data.people.filter((p) => p.active);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("hint", { org: (ar ? org.nameAr : null) ?? org.name })}
            {org.engagementMode === "restricted" ? ` ${t("restrictedHint")}` : ""}
          </p>
        </div>
        {roles.length ? (
          <FormDialog
            trigger={
              <Button>
                <UserPlus />
                {t("invite")}
              </Button>
            }
            title={t("invite")}
            description={t("inviteHint")}
            endpoint={`/api/orgs/${org.id}/invitations`}
            fields={[
              { name: "name", label: t("name"), required: true, maxLength: 120 },
              { name: "email", label: t("email"), required: true, maxLength: 254, dir: "ltr" },
              {
                name: "role",
                label: t("role"),
                type: "select",
                required: true,
                options: roles.map((r) => ({ value: r, label: tRole(r) })),
              },
            ]}
            submitLabel={t("invite")}
          />
        ) : (
          <p className="max-w-sm text-sm text-muted-foreground">{t("cannotInvite")}</p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("role")}</TableHead>
              <TableHead>{t("twoFactor")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.people.map((p) => {
              const self = p.userId === me;
              // The same rule as the database: a client admin doesn't change a fellow admin's address or two-factor.
              const canChange = !self && (myRole === "firm_admin" || p.role !== "client_admin");
              return (
                <TableRow key={p.userId} className={p.active ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <p className="font-medium">
                      {p.name}
                      {self ? <span className="ms-2 text-xs font-normal text-muted-foreground">({t("you")})</span> : null}
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span dir="ltr">{p.email}</span>
                      {p.personalEmail ? <Badge variant="outline">{t("personal")}</Badge> : null}
                    </p>
                  </TableCell>
                  <TableCell>{tRole(p.role)}</TableCell>
                  <TableCell>
                    <Badge variant={p.twoFactor ? "secondary" : "outline"}>{p.twoFactor ? t("on") : t("notSetUp")}</Badge>
                  </TableCell>
                  <TableCell className="max-w-64 text-sm whitespace-normal">
                    {p.active ? t("active") : p.deactivationReason ? t("offBecause", { reason: p.deactivationReason }) : t("off")}
                  </TableCell>
                  <TableCell className="text-end">
                    {self ? null : (
                      <PersonMenu
                        userId={p.userId}
                        name={p.name}
                        active={p.active}
                        canChange={canChange}
                        canResetTwoFactor={canChange && p.twoFactor}
                        canErase={data.can.erase}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("invitations")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-5 text-sm">
            {data.invitations.length === 0 ? <p className="text-muted-foreground">{t("noInvites")}</p> : null}
            {data.invitations.map((i) => (
              <div key={i.id} className="flex items-start justify-between gap-2 border-t pt-3 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{i.name}</p>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">
                    {i.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tRole(i.role)} · {t("expires", { date: day(i.expiresAt) })}
                  </p>
                </div>
                <ApiButton
                  endpoint={`/api/invitations/${i.id}`}
                  method="DELETE"
                  label={t("revoke")}
                  variant="ghost"
                  confirm={t("revokeConfirm", { email: i.email })}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("domains")}</CardTitle>
            <CardDescription>{org.allowedEmailDomains?.length ? null : t("domainsAny")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5 text-sm">
            {org.allowedEmailDomains?.length ? (
              <p className="flex flex-wrap gap-1.5" dir="ltr">
                {org.allowedEmailDomains.map((d) => (
                  <Badge key={d} variant="outline">
                    @{d}
                  </Badge>
                ))}
              </p>
            ) : null}
            <DomainsDialog orgId={org.id} domains={org.allowedEmailDomains ?? []} firm={firm} />
          </CardContent>
        </Card>

        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("review")}</CardTitle>
            <CardDescription>
              {data.lastAccessReview ? t("reviewLast", { date: day(data.lastAccessReview) }) : t("reviewNever")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5 text-sm">
            <p className="text-muted-foreground">{reviewDays ? t("reviewHint", { days: reviewDays }) : t("reviewHintClient")}</p>
            {active.length ? (
              <AccessReview
                orgId={org.id}
                people={active.map((p) => ({ userId: p.userId, name: p.name, email: p.email, self: p.userId === me }))}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

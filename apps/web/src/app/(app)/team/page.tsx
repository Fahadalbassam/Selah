import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { withPrincipal } from "@/server/page";
import { listTeam } from "@/services/queries";
import { EmptyState } from "@/components/empty-state";
import { Users } from "@/components/animate-ui/icons/users";

export default async function TeamPage() {
  const team = await withPrincipal((tx, principal) => listTeam(tx, principal));
  const [t, tRole] = await Promise.all([getTranslations("team"), getTranslations("role")]);
  const showTwoFactor = team.some((m) => m.twoFactor !== null);
  return (
    <>
      <PageHeader title={t("title")} />
      {team.length === 0 ? (
        <EmptyState icon={<Users animateOnView />} description={t("empty")} />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("email")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead className="text-end">{t("projects")}</TableHead>
                {showTwoFactor ? <TableHead>{t("twoFactor")}</TableHead> : null}
                {showTwoFactor ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell" dir="ltr">
                    {m.email}
                  </TableCell>
                  <TableCell>{tRole(m.role)}</TableCell>
                  <TableCell className="text-end tabular-nums">{m.projectCount}</TableCell>
                  {showTwoFactor ? (
                    <TableCell>
                      <Badge variant={m.twoFactor ? "secondary" : "outline"}>
                        {m.twoFactor ? t("twoFactorOn") : t("twoFactorOff")}
                      </Badge>
                    </TableCell>
                  ) : null}
                  {showTwoFactor ? (
                    <TableCell className="text-end">
                      {m.canResetTwoFactor ? (
                        <FormDialog
                          trigger={
                            <Button variant="ghost" size="sm">
                              {t("resetTwoFactor")}
                            </Button>
                          }
                          title={t("resetTwoFactorTitle", { name: m.name })}
                          description={t("resetTwoFactorHint")}
                          endpoint={`/api/people/${m.id}/two-factor-reset`}
                          fields={[{ name: "reason", label: t("reason"), type: "textarea", required: true, maxLength: 500 }]}
                          submitLabel={t("resetTwoFactor")}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

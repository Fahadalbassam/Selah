import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { withPrincipal } from "@/server/page";
import { listTeam } from "@/services/queries";
import { EmptyState } from "@/components/empty-state";
import { Users } from "@/components/animate-ui/icons/users";

export default async function TeamPage() {
  const team = await withPrincipal((tx, principal) => listTeam(tx, principal));
  const [t, tRole] = await Promise.all([getTranslations("team"), getTranslations("role")]);
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

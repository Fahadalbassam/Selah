import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { withPrincipal } from "@/server/page";
import { listClients } from "@/services/queries";

export default async function ClientsPage() {
  const clients = await withPrincipal(async (tx, principal) => (principal.orgKind === "firm" ? listClients(tx, principal) : null));
  if (!clients) notFound();
  const t = await getTranslations("clients");
  const ar = (await getLocale()) === "ar";
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      {clients.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("title")}</TableHead>
                <TableHead>{t("consultants")}</TableHead>
                <TableHead className="text-end">{t("projects")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{(ar ? c.nameAr : null) ?? c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.consultants.length ? c.consultants.join("، ") : t("none")}</TableCell>
                  <TableCell className="text-end tabular-nums">{c.projectCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

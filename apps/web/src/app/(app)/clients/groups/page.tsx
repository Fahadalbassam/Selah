import { Plus } from "@/components/animate-ui/icons/plus";
import { MorphTitle } from "@/components/morph";
import { Users } from "@/components/animate-ui/icons/users";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authorize } from "@/authz";
import { localLabel, localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { listGroups } from "@/services/client-groups";

// Holding groups (F34) for firm staff: the admin sees and keeps them all; a
// consultant sees the groups of the clients they are assigned to.
export default async function ClientGroupsPage() {
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    return {
      admin: principal.role === "firm_admin",
      canCreate: authorize(principal, "client_group.manage", { type: "client_group", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null })
        .allowed,
      groups: await listGroups(tx, principal),
    };
  });
  if (!data) notFound();
  const t = await getTranslations("clientGroups");
  const ar = (await getLocale()) === "ar";

  return (
    <>
      <PageHeader title={t("title")} description={data.admin ? t("subtitleAdmin") : t("subtitle")}>
        {data.canCreate ? (
          <FormDialog
            trigger={
              <Button>
                <Plus />
                {t("new")}
              </Button>
            }
            title={t("new")}
            description={t("newHint")}
            endpoint="/api/client-groups"
            fields={[
              { name: "nameAr", label: t("nameAr"), required: true, maxLength: 200, dir: "rtl" },
              { name: "nameEn", label: t("nameEn"), maxLength: 200, dir: "ltr" },
              { name: "notes", label: t("notes"), type: "textarea", maxLength: 2000 },
            ]}
            submitLabel={t("create")}
            redirectTo="/clients/groups/:id"
          />
        ) : null}
      </PageHeader>

      {data.groups.length === 0 ? (
        <EmptyState icon={<Users animateOnView />} description={data.admin ? t("empty") : t("emptyConsultant")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("group")}</TableHead>
                <TableHead>{t("members")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">
                    <Link href={`/clients/groups/${g.id}`} className="hover:underline">
                      <MorphTitle name={`group-${g.id}`} className="inline-block">
                        {localLabel(g, ar)}
                      </MorphTitle>
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {g.members.length ? g.members.map((m) => localName(m, ar)).join(ar ? "، " : ", ") : t("noMembers")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

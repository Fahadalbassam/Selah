import { Plus } from "@/components/animate-ui/icons/plus";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { PeopleStack } from "@/components/people-stack";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authorize } from "@/authz";
import { withPrincipal } from "@/server/page";
import { listClients } from "@/services/queries";
import { clientDirectory, myPendingRequests, pendingRequestCounts } from "@/services/staffing";
import { EmptyState } from "@/components/empty-state";
import { Users } from "@/components/animate-ui/icons/users";
import { ToneBadge } from "@/components/tone-badge";

export default async function ClientsPage() {
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    const firm = { type: "organization" as const, orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null };
    return {
      admin: principal.role === "firm_admin",
      canAdd: authorize(principal, "organization.create", firm).allowed,
      clients: await listClients(tx, principal),
      directory: principal.role === "consultant" ? (await clientDirectory(tx, principal)).filter((c) => !c.assigned) : [],
      mine: await myPendingRequests(tx, principal),
      requests: await pendingRequestCounts(tx, principal),
    };
  });
  if (!data) notFound();
  const [t, tc] = await Promise.all([getTranslations("staffing"), getTranslations("clients")]);
  const ar = (await getLocale()) === "ar";
  const name = (c: { name: string; nameAr: string | null }) => (ar ? c.nameAr : null) ?? c.name;

  return (
    <>
      <PageHeader title={tc("title")} description={data.admin ? t("subtitleAdmin") : t("subtitle")}>
        {data.canAdd ? (
          <FormDialog
            trigger={
              <Button>
                <Plus />
                {t("addClient")}
              </Button>
            }
            title={t("addClient")}
            description={t("addClientHint")}
            endpoint="/api/clients"
            fields={[
              { name: "name", label: t("nameEn"), required: true, dir: "ltr" },
              { name: "nameAr", label: t("nameAr"), dir: "rtl" },
            ]}
            submitLabel={t("create")}
            redirectTo="/clients/:id"
          />
        ) : null}
      </PageHeader>

      {data.clients.length === 0 ? (
        <EmptyState icon={<Users animateOnView />} description={tc("empty")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("client")}</TableHead>
                <TableHead>{t("lead")}</TableHead>
                <TableHead>{t("team")}</TableHead>
                <TableHead className="text-end">{t("projects")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.clients.map((c) => {
                const pending = data.requests.get(c.id) ?? 0;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/clients/${c.id}`} className="hover:underline">
                        {name(c)}
                      </Link>
                      {pending ? (
                        <ToneBadge tone="waiting" className="ms-2">
                          {t("requests", { count: pending })}
                        </ToneBadge>
                      ) : null}
                    </TableCell>
                    <TableCell className={c.lead ? "" : "text-muted-foreground"}>{c.lead ?? t("noLead")}</TableCell>
                    <TableCell>
                      <PeopleStack names={c.consultants} empty={tc("none")} />
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{c.projectCount}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {data.directory.length ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("otherClients")}</CardTitle>
            <CardDescription>{t("otherHint")}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y px-5">
            {data.directory.map((c) => {
              const requestId = data.mine.get(c.id);
              return (
                <div key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm font-medium">{name(c)}</span>
                  {requestId ? (
                    <span className="flex items-center gap-3">
                      <ToneBadge tone="waiting">{t("pending")}</ToneBadge>
                      <ApiButton endpoint={`/api/join-requests/${requestId}/withdraw`} label={t("withdraw")} variant="ghost" />
                    </span>
                  ) : (
                    <FormDialog
                      trigger={
                        <Button variant="outline" size="sm">
                          {t("requestJoin")}
                        </Button>
                      }
                      title={t("requestTitle", { client: name(c) })}
                      description={t("requestHint")}
                      endpoint={`/api/clients/${c.id}/join-requests`}
                      fields={[{ name: "reason", label: t("reason"), type: "textarea", required: true }]}
                      submitLabel={t("send")}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

import { FilePlus2, UserPlus } from "lucide-react";
import { Sparkles } from "@/components/animate-ui/icons/sparkles";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { authorCandidates, listTemplateAuthors, listTemplates } from "@/services/assessments";

export default async function TemplatesPage() {
  const data = await withPrincipal(async (tx, principal) =>
    principal.orgKind === "firm"
      ? {
          list: await listTemplates(tx, principal, { includeArchived: true }),
          authors: await listTemplateAuthors(tx, principal),
          candidates: await authorCandidates(tx, principal),
          admin: principal.role === "firm_admin",
        }
      : null,
  );
  if (!data) notFound();
  const [t, format] = await Promise.all([getTranslations("assessment.templates"), getFormatter()]);
  const ar = (await getLocale()) === "ar";
  const { list, authors, candidates, admin } = data;
  // An admin is always an author, even before the firm has a template.
  const canAuthor = list.canAuthor || admin;

  return (
    <>
      <PageHeader title={t("title")} description={t("hint")}>
        {canAuthor ? (
          <div className="flex flex-wrap gap-2">
            <ApiButton
              endpoint="/api/assessment-templates/starter"
              label={t("installStarter")}
              icon={<Sparkles />}
              title={t("installStarterHint")}
            />
            <FormDialog
              trigger={
                <Button size="sm">
                  <FilePlus2 />
                  {t("new")}
                </Button>
              }
              title={t("new")}
              description={t("newHint")}
              endpoint="/api/assessment-templates"
              fields={[
                { name: "name", label: t("name"), required: true, dir: "ltr" },
                { name: "nameAr", label: t("nameAr"), dir: "rtl" },
                { name: "description", label: t("description"), type: "textarea" },
              ]}
              submitLabel={t("create")}
              redirectTo="/templates/:id"
            />
          </div>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-xl border bg-card">
          {list.templates.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{canAuthor ? t("emptyAuthor") : t("empty")}</p>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t("template")}</TableHead>
                  <TableHead>{t("published")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.templates.map((tp) => (
                  <TableRow key={tp.id}>
                    <TableCell className="font-medium">
                      <Link href={`/templates/${tp.id}`} className="hover:underline">
                        {localName(tp, ar)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {tp.published
                        ? t("versionOn", {
                            version: tp.published.version,
                            date: tp.published.publishedAt
                              ? format.dateTime(tp.published.publishedAt, { dateStyle: "medium" })
                              : "—",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="space-x-1 rtl:space-x-reverse">
                      {tp.archivedAt ? <Badge variant="secondary">{t("archived")}</Badge> : null}
                      {tp.draft ? <Badge variant="outline">{t("draftOpen")}</Badge> : null}
                      {!tp.archivedAt && tp.published ? <Badge variant="outline">{t("inUse")}</Badge> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <Card className="h-fit gap-4 py-5 shadow-xs">
          <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
            <div className="space-y-1.5">
              <CardTitle className="text-base">{t("authors")}</CardTitle>
              <CardDescription>{t("authorsHint")}</CardDescription>
            </div>
            {admin && candidates.length ? (
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    <UserPlus />
                    {t("addAuthor")}
                  </Button>
                }
                title={t("addAuthor")}
                description={t("authorsHint")}
                endpoint="/api/template-authors/:userId"
                method="PUT"
                fields={[
                  {
                    name: "userId",
                    label: t("consultant"),
                    type: "person",
                    required: true,
                    options: candidates.map((c) => ({ value: c.userId, label: c.name, hint: c.email })),
                  },
                ]}
                submitLabel={t("add")}
              />
            ) : null}
          </CardHeader>
          <CardContent className="divide-y px-5">
            {authors.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t("noAuthors")}</p> : null}
            {authors.map((a) => (
              <div key={a.userId} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 text-sm font-medium">{a.name}</span>
                {admin ? (
                  <ApiButton
                    endpoint={`/api/template-authors/${a.userId}`}
                    method="DELETE"
                    label={t("remove")}
                    variant="ghost"
                    confirm={t("removeConfirm", { name: a.name })}
                  />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

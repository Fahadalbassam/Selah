import { Bot, FileText, Lock } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { withPrincipal } from "@/server/page";
import { getProject, isOverdue } from "@/services/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await withPrincipal((tx, principal) => getProject(tx, principal, id));
  const [t, tVis, tKind, tPrio, tStatus, format] = await Promise.all([
    getTranslations("project"),
    getTranslations("visibility"),
    getTranslations("kind"),
    getTranslations("priority"),
    getTranslations("status"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { project } = data;

  return (
    <>
      <PageHeader title={project.title} description={project.description ?? undefined}>
        <Badge variant={project.kind === "internal" ? "secondary" : "outline"}>
          {tKind(project.kind)}
          {project.kind === "client" ? ` · ${(ar ? project.orgNameAr : null) ?? project.orgName}` : ""}
        </Badge>
      </PageHeader>
      {project.kind === "internal" ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          {t("internalBanner")}
        </p>
      ) : null}

      <Tabs defaultValue="recs" className="gap-4">
        <TabsList>
          <TabsTrigger value="recs">{t("recommendations")}</TabsTrigger>
          <TabsTrigger value="docs">{t("documents")}</TabsTrigger>
          <TabsTrigger value="activity">{t("activity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="recs" className="space-y-4">
          {data.recommendations.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRecs")}</p> : null}
          {data.recommendations.map((r) => (
            <Card key={r.id} className="gap-4 py-5 shadow-xs">
              <CardHeader className="px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{r.title}</CardTitle>
                  <Badge variant="outline">
                    {t("priority")}: {tPrio(r.priority)}
                  </Badge>
                </div>
                {r.rationale ? <CardDescription>{r.rationale}</CardDescription> : null}
                {r.requiredEvidence ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t("requiredEvidence")}:</span> {r.requiredEvidence}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="px-5">
                <ActionsTable rows={r.actions.map((a) => ({ ...a, overdue: isOverdue(a) }))} empty="—" showProject={false} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="docs">
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDocs")}</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {data.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <FileText className="size-4 text-muted-foreground" />
                  <a href={`/api/documents/${d.id}/download`} className="font-medium hover:underline">
                    {d.title}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {t("version")} {d.version}
                  </span>
                  <Badge variant={d.visibility === "shared" ? "outline" : "secondary"} className="ms-auto">
                    {tVis(d.visibility)}
                  </Badge>
                  {d.aiIndexable ? (
                    <Badge variant="outline" className="gap-1">
                      <Bot className="size-3" />
                      {t("aiIndexed")}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="activity">
          {data.activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noActivity")}</p>
          ) : (
            <ol className="space-y-3 border-s ps-4">
              {data.activity.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{e.actorName ?? "—"}</span>{" "}
                  {e.fromState && e.toState
                    ? t("changed", { from: tStatus(e.fromState as never), to: tStatus(e.toState as never) })
                    : e.event}
                  <div className="text-xs text-muted-foreground">{format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

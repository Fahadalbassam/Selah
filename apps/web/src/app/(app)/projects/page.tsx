import { Building2, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { withPrincipal } from "@/server/page";
import { listProjects } from "@/services/queries";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const { projects, firm } = await withPrincipal(async (tx, principal) => ({
    projects: await listProjects(tx, principal),
    firm: principal.orgKind === "firm",
  }));
  const shown = kind === "internal" || kind === "client" ? projects.filter((p) => p.kind === kind) : projects;
  const [t, tKind, tS] = await Promise.all([getTranslations("projects"), getTranslations("kind"), getTranslations("staffing")]);
  const ar = (await getLocale()) === "ar";

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        {firm ? (
          <FormDialog
            trigger={
              <Button variant={kind === "internal" ? "default" : "outline"}>
                <Plus />
                {tS("newInternal")}
              </Button>
            }
            title={tS("newInternal")}
            description={tS("newInternalHint")}
            endpoint="/api/projects/internal"
            fields={[
              { name: "title", label: tS("title"), required: true },
              { name: "description", label: tS("description"), type: "textarea" },
            ]}
            submitLabel={tS("create")}
            redirectTo="/projects/:id"
          />
        ) : null}
      </PageHeader>
      {firm ? <p className="text-xs text-muted-foreground">{t("internalNote")}</p> : null}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => {
            const pct = p.actionCount ? Math.round((p.verifiedCount / p.actionCount) * 100) : 0;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="group">
                <Card className="h-full gap-3 py-5 shadow-xs transition-colors group-hover:border-primary/40">
                  <CardHeader className="px-5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={p.kind === "internal" ? "secondary" : "outline"} className="gap-1">
                        {p.kind === "internal" ? <Lock className="size-3" /> : <Building2 className="size-3" />}
                        {tKind(p.kind)}
                      </Badge>
                    </div>
                    <CardTitle className="text-base leading-snug">{p.title}</CardTitle>
                    {p.kind === "client" ? (
                      <CardDescription>
                        {t("client")}: {(ar ? p.orgNameAr : null) ?? p.orgName}
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-2 px-5">
                    <Progress value={pct} aria-label={`${pct}%`} />
                    <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                      <span>
                        {p.actionCount} {t("actions")}
                      </span>
                      <span>
                        {p.verifiedCount} {t("verified")}
                      </span>
                      <span>
                        {p.awaitingReviewCount} {t("awaitingReview")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

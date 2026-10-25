import { Building2 } from "lucide-react";
import { Tilt, TiltContent } from "@animate-ui/react/primitives/effects/tilt";
import { MorphTitle } from "@/components/morph";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Plus } from "@/components/animate-ui/icons/plus";
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
import { EmptyState } from "@/components/empty-state";
import { FileText } from "@/components/animate-ui/icons/file-text";

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
        <EmptyState icon={<FileText animateOnView />} description={t("empty")} />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => {
            const pct = p.actionCount ? Math.round((p.verifiedCount / p.actionCount) * 100) : 0;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="group">
                {/* The card leans a few degrees toward the pointer (Animate UI Tilt). */}
                <Tilt maxTilt={3} className="h-full">
                  <TiltContent className="h-full">
                    <Card className="h-full gap-3 py-5 shadow-xs transition-[border-color,box-shadow,translate] duration-(--duration-base) ease-(--ease-out-soft) group-hover:-translate-y-0.5 group-hover:border-foreground/20 group-hover:shadow-md">
                      <CardHeader className="px-5">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={p.kind === "internal" ? "secondary" : "outline"} className="gap-1">
                            {p.kind === "internal" ? <Lock className="size-3" /> : <Building2 className="size-3" />}
                            {tKind(p.kind)}
                          </Badge>
                        </div>
                        <CardTitle className="text-base leading-snug">
                          <MorphTitle name={`project-${p.id}`}>{p.title}</MorphTitle>
                        </CardTitle>
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
                  </TiltContent>
                </Tilt>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

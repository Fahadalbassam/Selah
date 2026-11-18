import { Building2, FilePenLine } from "lucide-react";
import { Tilt, TiltContent } from "@animate-ui/react/primitives/effects/tilt";
import { MorphTitle } from "@/components/morph";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Plus } from "@/components/animate-ui/icons/plus";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FormDialog } from "@/components/form-dialog";
import { LinkTabs } from "@/components/link-tabs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { withPrincipal } from "@/server/page";
import { listProjects } from "@/services/queries";
import { projectsTable } from "@/services/action-board";
import { ProjectsTable, ProjectViewLinks } from "./projects-table";
import { EmptyState } from "@/components/empty-state";
import { FileText } from "@/components/animate-ui/icons/file-text";

// The firm's kind filter (page audit 4.1: the sidebar's three Projects sub-entries). It keeps the table view.
const KINDS = [
  { kind: null, href: "/projects", table: "/projects?view=table", label: "allProjects" },
  { kind: "client", href: "/projects?kind=client", table: "/projects?view=table&kind=client", label: "clientProjects" },
  { kind: "internal", href: "/projects?kind=internal", table: "/projects?view=table&kind=internal", label: "internalProjects" },
] as const;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ kind?: string; view?: string }> }) {
  const { kind, view } = await searchParams;
  const { projects, firm, table } = await withPrincipal(async (tx, principal) => {
    // The firm's table view (page audit 4.6): Oversight's columns per project, as counts (D5).
    const table = principal.orgKind === "firm" && view === "table" ? await projectsTable(tx, principal) : null;
    return { projects: table ? [] : await listProjects(tx, principal), firm: principal.orgKind === "firm", table };
  });
  const ofKind = <T extends { kind: string }>(list: T[]) => (kind === "internal" || kind === "client" ? list.filter((p) => p.kind === kind) : list);
  const shown = ofKind(projects);
  const [t, tKind, tS, tNav] = await Promise.all([getTranslations("projects"), getTranslations("kind"), getTranslations("staffing"), getTranslations("nav")]);
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
      {firm ? (
        <LinkTabs
          label={tNav("projectKinds")}
          tabs={KINDS.map((k) => ({ href: table ? k.table : k.href, label: tNav(k.label) }))}
          current={((k) => (table ? k.table : k.href))(KINDS.find((k) => k.kind === kind) ?? KINDS[0])}
        />
      ) : null}
      {firm ? <p className="text-xs text-muted-foreground">{t("internalNote")}</p> : null}
      {firm ? <ProjectViewLinks view={table ? "table" : "cards"} kind={kind === "internal" || kind === "client" ? kind : undefined} /> : null}
      {table ? (
        <ProjectsTable rows={ofKind(table)} />
      ) : shown.length === 0 ? (
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
                        {/* The kind and the client's name are the firm's to sort by; a client reader's projects are all its own. */}
                        {firm ? (
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant={p.kind === "internal" ? "secondary" : "outline"} className="gap-1">
                              {p.kind === "internal" ? <Lock className="size-3" /> : p.pitch ? <FilePenLine className="size-3" /> : <Building2 className="size-3" />}
                              {p.pitch ? tKind("pitch") : tKind(p.kind)}
                            </Badge>
                          </div>
                        ) : null}
                        <CardTitle className="text-base leading-snug">
                          <MorphTitle name={`project-${p.id}`}>{p.title}</MorphTitle>
                        </CardTitle>
                        {p.kind === "client" && firm ? (
                          <CardDescription>
                            {t("client")}: {(ar ? p.orgNameAr : null) ?? p.orgName}
                          </CardDescription>
                        ) : null}
                      </CardHeader>
                      <CardContent className="space-y-2 px-5">
                        <Progress value={pct} aria-label={`${pct}%`} />
                        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                          <span>{t("actions", { n: p.actionCount })}</span>
                          <span>{t("verified", { n: p.verifiedCount })}</span>
                          <span>{t("awaitingReview", { n: p.awaitingReviewCount })}</span>
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

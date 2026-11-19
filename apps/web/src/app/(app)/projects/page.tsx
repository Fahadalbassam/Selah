import { Building2, FilePenLine } from "lucide-react";
import { Tilt, TiltContent } from "@animate-ui/react/primitives/effects/tilt";
import { MorphTitle } from "@/components/morph";
import { Lock } from "@/components/animate-ui/icons/lock";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { authorize } from "@/authz";
import { firmToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { listClients } from "@/services/queries";
import { NewProjectDialog } from "./new-project";
import { LinkTabs } from "@/components/link-tabs";
import { PageHeader } from "@/components/page-header";
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
  const ar = (await getLocale()) === "ar";
  const { projects, firm, table, newFor, canInternal } = await withPrincipal(async (tx, principal) => {
    // The firm's table view (page audit 4.6): Oversight's columns per project, as counts (D5).
    const table = principal.orgKind === "firm" && view === "table" ? await projectsTable(tx, principal) : null;
    const firm = principal.orgKind === "firm";
    // The clients this person may start a project for (the firm admin: any active one; a lead: theirs).
    const clients = firm ? await listClients(tx, principal) : [];
    const newFor = clients
      .filter(
        (c) =>
          c.status === "active" &&
          !c.prospect &&
          authorize(principal, "project.create", {
            type: "project",
            orgId: c.id,
            firmOrgId: principal.orgId,
            projectId: null,
            projectKind: "client",
            clientOrgId: c.id,
          }).allowed,
      )
      .map((c) => ({ id: c.id, name: (ar ? c.nameAr : null) ?? c.name }));
    const canInternal = firm && authorize(principal, "project.create_internal", { type: "project", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null, projectKind: "internal" }).allowed;
    return { projects: table ? [] : await listProjects(tx, principal), firm, table, newFor, canInternal };
  });
  const ofKind = <T extends { kind: string }>(list: T[]) => (kind === "internal" || kind === "client" ? list.filter((p) => p.kind === kind) : list);
  const shown = ofKind(projects);
  const [t, tKind, tNav, format] = await Promise.all([getTranslations("projects"), getTranslations("kind"), getTranslations("nav"), getFormatter()]);
  const today = firmToday();

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        {/* One "New project" (October review, item 3); its first field is the kind. */}
        {firm ? <NewProjectDialog clients={newFor} internal={canInternal} /> : null}
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
                        {/* The next due date of an open action this reader may read (October review, item 3). */}
                        {p.state === "closed" ? null : (
                          <p className={cn("text-xs tabular-nums", p.nextDue && p.nextDue < today ? "font-medium text-destructive" : "text-muted-foreground")}>
                            {p.nextDue
                              ? t(p.nextDue < today ? "nextDueLate" : "nextDue", { date: format.dateTime(new Date(`${p.nextDue}T12:00:00Z`), { dateStyle: "medium" }) })
                              : t("nothingDue")}
                          </p>
                        )}
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

import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { FolderOpen } from "@/components/animate-ui/icons/folder-open";
import { EmptyState } from "@/components/empty-state";
import { MorphTitle } from "@/components/morph";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actionsHref, type ActionFilterKey } from "@/lib/action-filters";
import { cn } from "@/lib/utils";
import type { ProjectTableRow } from "@/services/action-board";

/** Cards or the table, as links: the view stays in the address beside the kind (firm only). */
export function ProjectViewLinks({ view, kind }: { view: "cards" | "table"; kind?: string }) {
  const t = useTranslations("projectsTable");
  const href = (v: "cards" | "table") => {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (v === "table") p.set("view", "table");
    const s = p.toString();
    return s ? `/projects?${s}` : "/projects";
  };
  return (
    <nav aria-label={t("viewLabel")} className="-mt-3 flex items-center gap-1">
      {(["cards", "table"] as const).map((v) => (
        <Link key={v} href={href(v)} aria-current={view === v ? "page" : undefined} className={buttonVariants({ variant: view === v ? "secondary" : "ghost", size: "sm" })}>
          {t(v)}
        </Link>
      ))}
    </nav>
  );
}

/** A count that opens its own list on Actions (the same number, page audit 4.6). Zero and closed projects stay plain. */
function CountLink({ n, filter, projectId, label, problem }: { n: number | null; filter: ActionFilterKey; projectId: string; label: string; problem?: boolean }) {
  if (n === null) return <span className="text-muted-foreground">—</span>;
  if (n === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <Link href={actionsHref({ filter, project: projectId })} aria-label={label} className={cn("font-medium hover:underline", problem && "text-destructive")}>
      {n}
    </Link>
  );
}

/**
 * The Projects page as a table, for the firm (page audit 4.6): what
 * Oversight showed per project, as counts and never a health word (D5):
 * open, late, blocked, the oldest waiting review, the lead, and when someone
 * at the client last did something. Each count opens its list on Actions.
 */
export function ProjectsTable({ rows }: { rows: ProjectTableRow[] }) {
  const t = useTranslations("projectsTable");
  const tKind = useTranslations("kind");
  const tProjects = useTranslations("projects");
  const format = useFormatter();
  const ar = useLocale() === "ar";
  if (rows.length === 0) return <EmptyState icon={<FolderOpen animateOnView />} description={tProjects("empty")} />;
  const now = new Date();
  const lastActive = (r: ProjectTableRow) => {
    if (r.kind === "internal") return "—";
    if (r.mode === "consultant_managed") return t("recordedByFirm");
    return r.clientLastActive ? format.relativeTime(r.clientLastActive, now) : t("never");
  };
  return (
    <>
      <p className="-mt-3 text-xs text-muted-foreground">{t("hint")}</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("project")}</TableHead>
              <TableHead className="text-end">{t("open")}</TableHead>
              <TableHead className="text-end">{t("late")}</TableHead>
              <TableHead className="text-end">{t("blocked")}</TableHead>
              <TableHead className="text-end">{t("oldestReview")}</TableHead>
              <TableHead>{t("lead")}</TableHead>
              <TableHead>{t("clientActive")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.projectId}>
                <TableCell className="max-w-72">
                  <Link href={`/projects/${r.projectId}`} className="block truncate font-medium hover:underline">
                    <MorphTitle name={`project-${r.projectId}`} className="truncate" dir="auto">
                      {r.title}
                    </MorphTitle>
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate" dir="auto">
                      {r.kind === "internal" ? t("internal") : ((ar ? r.clientNameAr : null) ?? r.clientName)}
                    </span>
                    {r.pitch ? (
                      <Badge variant="outline" className="px-1.5 py-0 text-xs">
                        {tKind("pitch")}
                      </Badge>
                    ) : null}
                    {r.state === "closed" ? (
                      <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                        {t("closed")}
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-end tabular-nums">{r.open ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-end tabular-nums">
                  <CountLink n={r.late} filter="late" projectId={r.projectId} label={t("lateOf", { project: r.title })} problem />
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  <CountLink n={r.blocked} filter="blocked" projectId={r.projectId} label={t("blockedOf", { project: r.title })} />
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {r.oldestReviewDays === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Link href={actionsHref({ filter: "awaiting-review", project: r.projectId })} aria-label={t("reviewsOf", { project: r.title })} className="hover:underline">
                      {t("days", { n: r.oldestReviewDays })}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.lead ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{lastActive(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

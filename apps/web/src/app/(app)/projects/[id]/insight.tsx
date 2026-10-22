"use client";

import { FileText, Gauge, ListChecks, Search, Target, Lightbulb, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/authz";

/** What moved since this person last opened the project. Shown once, then the mark moves to now. */
export function SinceLastVisit(props: {
  projectId: string;
  since: string | Date;
  firstVisit: boolean;
  changes: { actionId: string; title: string; status: string; changedAt: string | Date }[];
}) {
  const t = useTranslations("insight");
  const format = useFormatter();
  const [all, setAll] = useState(false);
  useEffect(() => {
    void fetch(`/api/projects/${props.projectId}/since-last-visit`, { method: "PUT" });
  }, [props.projectId]);
  if (!props.changes.length) return null;
  const shown = all ? props.changes : props.changes.slice(0, 5);
  return (
    <Card className="gap-3 py-4 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">
          {props.firstVisit
            ? t("since.firstTitle", { n: props.changes.length })
            : t("since.title", {
                n: props.changes.length,
                date: format.dateTime(new Date(props.since), { dateStyle: "medium" }),
              })}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <ul className="divide-y">
          {shown.map((c) => (
            <li key={c.actionId} className="flex items-center gap-3 py-2 text-sm">
              <Link href={`/actions/${c.actionId}`} className="min-w-0 flex-1 truncate hover:underline">
                {c.title}
              </Link>
              <StatusBadge status={c.status as ActionStatus} />
              <span className="w-28 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                {format.relativeTime(new Date(c.changedAt), new Date())}
              </span>
            </li>
          ))}
        </ul>
        {props.changes.length > 5 ? (
          <button type="button" onClick={() => setAll(!all)} className="mt-2 text-sm text-muted-foreground hover:text-foreground">
            {all ? t("since.fewer") : t("since.more", { n: props.changes.length - 5 })}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export interface DeviationRow {
  entityType: "action" | "kpi";
  entityId: string;
  rule: string;
  detail: Record<string, string | number | null>;
  title: string | null;
  titleAr: string | null;
  status: string | null;
  dueDate: string | null;
  owner: string | null;
}

/** The deviation rules over the project: what breaks which rule, and by how much. */
export function Deviations({ rows }: { rows: DeviationRow[] }) {
  const t = useTranslations("insight.deviations");
  const ar = useLocale() === "ar";
  const format = useFormatter();
  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.rule] = (m[r.rule] ?? 0) + 1), m), {});
  const detail = (r: DeviationRow) => {
    const d = r.detail;
    if (r.rule === "overdue" || r.rule === "stale") return t(`detail.${r.rule}`, { n: Number(d.days ?? 0) });
    if (r.rule === "slipped" || r.rule === "churn") return t(`detail.${r.rule}`, { n: Number(d.count ?? 0) });
    if (r.rule === "kpi_not_reported" || r.rule === "kpi_off_target") {
      const period = d.period_start ? format.dateTime(new Date(String(d.period_start)), { dateStyle: "medium" }) : "—";
      return t(`detail.${r.rule}`, { period });
    }
    return t(`detail.${r.rule}`);
  };
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("hint")}</p>
      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts).map(([rule, n]) => (
              <Badge key={rule} variant="outline" className="gap-1.5" title={t(`rules.${rule}.hint`)}>
                {t(`rules.${rule}.name`)}
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </Badge>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{t("item")}</TableHead>
                  <TableHead>{t("rule")}</TableHead>
                  <TableHead>{t("detailHead")}</TableHead>
                  <TableHead>{t("owner")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.entityId}-${r.rule}`}>
                    <TableCell className="max-w-80">
                      {r.entityType === "action" ? (
                        <Link href={`/actions/${r.entityId}`} className="block truncate font-medium hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 truncate font-medium">
                          <Gauge className="size-4 shrink-0 text-muted-foreground" />
                          {(ar ? r.titleAr : null) ?? r.title}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span title={t(`rules.${r.rule}.hint`)}>{t(`rules.${r.rule}.name`)}</span>
                    </TableCell>
                    <TableCell
                      className={cn("tabular-nums", (r.rule === "overdue" || r.rule === "orphaned") && "text-destructive")}
                    >
                      {detail(r)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.owner ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

export interface TraceNode {
  nodeType: "objective" | "kpi" | "finding" | "recommendation" | "action" | "evidence" | "review";
  nodeId: string;
  parentType: TraceNode["nodeType"] | null;
  parentId: string | null;
  label: string | null;
  state: string | null;
}

const ICON = {
  objective: Target,
  kpi: Gauge,
  finding: Search,
  recommendation: Lightbulb,
  action: ListChecks,
  evidence: FileText,
};

/**
 * The project as one tree, from findings to the evidence and reviews that
 * close them, and from objectives to KPIs and the recommendations meant to
 * move them. A recommendation under a KPI is a cross-reference; it is shown
 * in full under its finding.
 */
export function Trace({ rows }: { rows: TraceNode[] }) {
  const t = useTranslations("insight.trace");
  const tPrio = useTranslations("priority");
  const children = new Map<string, TraceNode[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const k = `${r.parentType}:${r.parentId}`;
    children.set(k, [...(children.get(k) ?? []), r]);
  }
  const kids = (n: TraceNode) => children.get(`${n.nodeType}:${n.nodeId}`) ?? [];
  const roots = (type: TraceNode["nodeType"]) => rows.filter((r) => r.nodeType === type && !r.parentId);
  // Recommendations whose only parent is a KPI still belong at the top of the work tree.
  const withFinding = new Set(
    rows.filter((r) => r.nodeType === "recommendation" && r.parentType === "finding").map((r) => r.nodeId),
  );
  const loose = rows.filter(
    (r, i, all) =>
      r.nodeType === "recommendation" &&
      !withFinding.has(r.nodeId) &&
      all.findIndex((x) => x.nodeType === "recommendation" && x.nodeId === r.nodeId) === i,
  );

  function Node({ n, depth, refOnly }: { n: TraceNode; depth: number; refOnly?: boolean }): ReactNode {
    if (n.nodeType === "review") {
      const Icon = n.state === "accept" ? CheckCircle2 : n.state === "revise" ? RotateCcw : XCircle;
      return (
        <li className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Icon className={cn("size-4", n.state === "accept" ? "text-success" : "text-destructive")} />
          {t(`review.${n.state ?? "reject"}`)}
        </li>
      );
    }
    const Icon = ICON[n.nodeType];
    const sub = refOnly ? [] : kids(n);
    const label = n.label ?? "—";
    return (
      <li className="py-1">
        <div className="flex items-center gap-2 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t(`types.${n.nodeType}`)}</span>
          {n.nodeType === "action" ? (
            <Link href={`/actions/${n.nodeId}`} className="min-w-0 truncate font-medium hover:underline">
              {label}
            </Link>
          ) : (
            <span className={cn("min-w-0 truncate", n.nodeType !== "evidence" && "font-medium")}>{label}</span>
          )}
          {n.nodeType === "action" && n.state ? <StatusBadge status={n.state as ActionStatus} /> : null}
          {n.nodeType === "action" && n.parentType === "action" ? <Badge variant="outline">{t("replaces")}</Badge> : null}
          {n.nodeType === "recommendation" && n.state ? (
            <span className="text-xs text-muted-foreground">{tPrio(n.state as never)}</span>
          ) : null}
          {n.nodeType === "evidence" && n.state === "consultant_recorded" ? (
            <span className="text-xs text-muted-foreground">{t("recorded")}</span>
          ) : null}
          {refOnly ? <span className="text-xs text-muted-foreground">{t("seeBelow")}</span> : null}
        </div>
        {sub.length ? (
          <ul className={cn("ms-2 border-s ps-4", depth > 3 && "ps-3")}>
            {sub.map((c) => (
              <Node key={`${c.nodeType}:${c.nodeId}:${n.nodeId}`} n={c} depth={depth + 1} refOnly={n.nodeType === "kpi"} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const findings = roots("finding");
  const objectives = roots("objective");
  const orphanKpis = rows.filter((r) => r.nodeType === "kpi" && !r.parentId);
  if (!findings.length && !objectives.length && !loose.length && !orphanKpis.length) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="grid gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("hint")}</p>
      {findings.length || loose.length ? (
        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("work")}</CardTitle>
            <CardDescription>{t("workHint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            <ul>
              {findings.map((n) => (
                <Node key={n.nodeId} n={n} depth={0} />
              ))}
              {loose.map((n) => (
                <Node key={n.nodeId} n={{ ...n, parentType: null, parentId: null }} depth={0} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {objectives.length || orphanKpis.length ? (
        <Card className="gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("goals")}</CardTitle>
            <CardDescription>{t("goalsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            <ul>
              {objectives.map((n) => (
                <Node key={n.nodeId} n={n} depth={0} />
              ))}
              {orphanKpis.map((n) => (
                <Node key={n.nodeId} n={n} depth={0} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

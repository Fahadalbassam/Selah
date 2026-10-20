import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/authz";

export interface ActionItem {
  id: string;
  title: string;
  status: ActionStatus;
  dueDate: string | null;
  ownerName: string | null;
  projectId: string;
  projectTitle: string;
  recommendationTitle: string;
  overdue: boolean;
}

export function ActionsTable({ rows, empty, showProject = true }: { rows: ActionItem[]; empty: string; showProject?: boolean }) {
  const t = useTranslations("table");
  const format = useFormatter();
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>{t("action")}</TableHead>
            {showProject ? <TableHead className="hidden md:table-cell">{t("project")}</TableHead> : null}
            <TableHead className="hidden sm:table-cell">{t("owner")}</TableHead>
            <TableHead>{t("due")}</TableHead>
            <TableHead>{t("status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-72">
                <div className="truncate font-medium">{r.title}</div>
                <div className="truncate text-xs text-muted-foreground">{r.recommendationTitle}</div>
              </TableCell>
              {showProject ? (
                <TableCell className="hidden md:table-cell">
                  <Link href={`/projects/${r.projectId}`} className="text-primary hover:underline">
                    {r.projectTitle}
                  </Link>
                </TableCell>
              ) : null}
              <TableCell className="hidden text-muted-foreground sm:table-cell">{r.ownerName ?? t("unassigned")}</TableCell>
              <TableCell className={cn("tabular-nums", r.overdue && "font-medium text-destructive")}>
                {r.dueDate ? format.dateTime(new Date(r.dueDate), { dateStyle: "medium" }) : "—"}
                {r.overdue ? <span className="ms-1 text-xs">({t("overdue")})</span> : null}
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

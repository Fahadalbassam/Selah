"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { EmptyState } from "@/components/empty-state";
import { callApi } from "@/components/form-dialog";
import { MorphTitle } from "@/components/morph";
import { RowMenu } from "@/components/row-menu";
import { StatusBadge } from "@/components/status-badge";
import { ToneBadge } from "@/components/tone-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { isRuleFilter, type ActionFilterKey } from "@/lib/action-filters";
import { ruleActionRowPlan } from "@/lib/row-actions";
import { cn } from "@/lib/utils";
import type { BoardRow } from "@/services/action-board";

/** The database's words for a refused reminder, as a message key under actionsPage.remind.errors. */
function remindError(message: string | undefined) {
  const m = message ?? "";
  if (m.includes("already reminded")) return "already";
  if (m.includes("no other active owner")) return "noOwner";
  if (m.includes("open action")) return "settled";
  return "cannot";
}

/**
 * The Actions list (page audit 4.6): one row per action, whatever rules it
 * breaks. "Awaiting review" adds how long it has waited and, for the firm,
 * how far its sign-off has got; the rule lists add why the action is on them
 * and, for the firm, "Remind the owner" in the row's menu.
 */
export function ActionBoardTable({ rows, filter, firm, empty }: { rows: BoardRow[]; filter: ActionFilterKey; firm: boolean; empty: string }) {
  const t = useTranslations("actionsPage");
  const tTable = useTranslations("table");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  if (rows.length === 0) return <EmptyState icon={<CircleCheck animateOnView />} description={empty} />;

  const review = filter === "awaiting-review";
  const rules = isRuleFilter(filter);
  const menus = rules && firm && rows.some((r) => r.remind?.can);
  const why = (r: BoardRow) => r.reasons.map((x) => t(`reasons.${x.rule}`, { n: x.n ?? 0 })).join(" · ");

  async function remind(r: BoardRow) {
    const res = await callApi(`/api/actions/${r.id}/remind`, "POST");
    if (!res.ok) return void toast.error(t(`remind.errors.${remindError(res.message)}`));
    toast.success(t("remind.sent", { name: r.ownerName ?? "" }));
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>{tTable("action")}</TableHead>
            <TableHead className="hidden md:table-cell">{tTable("project")}</TableHead>
            <TableHead className="hidden lg:table-cell">{tTable("owner")}</TableHead>
            {review ? <TableHead>{t("columns.waiting")}</TableHead> : null}
            {review && firm ? <TableHead>{t("columns.stage")}</TableHead> : null}
            {rules ? <TableHead>{t("columns.why")}</TableHead> : null}
            <TableHead>{tTable("due")}</TableHead>
            {review ? null : <TableHead>{tTable("status")}</TableHead>}
            {menus ? (
              <TableHead className="w-10">
                <span className="sr-only">{t("remind.menu")}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const plan = ruleActionRowPlan({ remind: !!r.remind?.can });
            return (
              <TableRow key={r.id}>
                <TableCell className="max-w-72">
                  {/* Each title takes its own direction, so an English title on an Arabic page is cut at its end, not its start. */}
                  <Link href={`/actions/${r.id}`} className="block truncate font-medium hover:underline">
                    <MorphTitle name={`action-${r.id}`} className="truncate" dir="auto">
                      {r.title}
                    </MorphTitle>
                  </Link>
                  <div className="w-fit max-w-full truncate text-xs text-muted-foreground" dir="auto">
                    {r.recommendationTitle}
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-56 md:table-cell">
                  <Link href={`/projects/${r.projectId}`} className="block truncate text-primary hover:underline" dir="auto">
                    {r.projectTitle}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {r.ownerName ?? tTable("unassigned")}
                  {r.remind?.lastReminded ? (
                    <span className="block text-xs">
                      {r.remind.remindedToday ? t("remind.today") : t("remind.last", { date: format.dateTime(new Date(`${r.remind.lastReminded}T00:00:00`), { dateStyle: "medium" }) })}
                    </span>
                  ) : null}
                </TableCell>
                {review ? (
                  <TableCell
                    className="tabular-nums"
                    title={r.review?.since ? format.dateTime(new Date(r.review.since), { dateStyle: "medium", timeStyle: "short" }) : undefined}
                  >
                    {r.review?.waitingDays == null ? "—" : t("review.days", { n: r.review.waitingDays })}
                  </TableCell>
                ) : null}
                {review && firm ? (
                  <TableCell>
                    {r.review?.stage ? (
                      <div className="flex flex-col items-start gap-1">
                        {r.review.stage.required ? (
                          <ToneBadge tone={r.review.stage.signedBy ? "active" : "waiting"}>
                            {r.review.stage.signedBy ? t("review.secondOfTwo") : t("review.firstOfTwo")}
                          </ToneBadge>
                        ) : (
                          <ToneBadge tone="waiting">{t("review.oneReview")}</ToneBadge>
                        )}
                        {r.review.stage.signedBy ? (
                          <span className="text-xs text-muted-foreground">
                            {r.review.stage.signedByMe ? t("review.youSigned") : t("review.signedBy", { name: r.review.stage.signedBy })}
                          </span>
                        ) : null}
                        {!r.review.stage.canAct && !r.review.stage.signedByMe ? <span className="text-xs text-muted-foreground">{t("review.notYours")}</span> : null}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                ) : null}
                {rules ? <TableCell className={cn("text-sm", r.late && "text-destructive")}>{why(r)}</TableCell> : null}
                <TableCell className={cn("tabular-nums", r.late && "font-medium text-destructive")}>
                  {r.dueDate ? format.dateTime(new Date(r.dueDate), { dateStyle: "medium" }) : "—"}
                  {r.late ? <span className="ms-1 text-xs">({tTable("overdue")})</span> : null}
                </TableCell>
                {review ? null : (
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                )}
                {menus ? (
                  <TableCell className="text-end">
                    <RowMenu
                      label={tc("moreFor", { name: r.title })}
                      items={plan.menu.map((k) => ({ key: k, label: t("remind.menu"), allowed: true, onSelect: () => void remind(r) }))}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { today, TODAY_WINDOW_DAYS, type TodayGroup } from "@/services/today";

/**
 * What needs this person today, across every client they work on (Wave 3).
 * Firm staff only; client users get a 404. Each section lists its rows under
 * the client they belong to (internal projects together), and every row
 * links to its record.
 */
export default async function TodayPage() {
  const data = await withPrincipal(async (tx, principal) => (principal.orgKind === "firm" ? today(tx, principal) : null));
  if (!data) notFound();
  const [t, tTable, format, locale] = await Promise.all([getTranslations("todayPage"), getTranslations("table"), getFormatter(), getLocale()]);
  const ar = locale === "ar";
  const groupName = (g: TodayGroup) => (g.internal ? t("internal") : ((ar ? g.nameAr : null) ?? g.name));
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const when = (d: Date) => format.dateTime(d, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const needs = data.reviews.length + data.due.length + data.followUps.length + data.meetings.length + data.decisions.length;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      {needs === 0 ? <EmptyState icon={<CircleCheck animateOnView />} title={t("empty")} description={t("emptyHint")} /> : null}

      <Section title={t("reviews.title")} description={t("reviews.description")} rows={data.reviews} groupName={groupName}>
        {(r) => (
          <>
            <Title href={r.href} title={r.title} sub={r.projectTitle} />
            <TableCell className="hidden text-muted-foreground md:table-cell">{r.ownerName ?? tTable("unassigned")}</TableCell>
            <TableCell className="text-end text-xs text-muted-foreground tabular-nums">
              {r.since ? t("reviews.since", { date: day(r.since) }) : null}
            </TableCell>
          </>
        )}
      </Section>

      <Section title={t("due.title")} description={t("due.description", { days: TODAY_WINDOW_DAYS })} rows={data.due} groupName={groupName}>
        {(r) => (
          <>
            <Title href={r.href} title={r.title} sub={r.projectTitle} />
            <TableCell className="hidden text-muted-foreground md:table-cell">{r.ownerName ?? tTable("unassigned")}</TableCell>
            <TableCell className={cn("tabular-nums", r.overdue && "font-medium text-destructive")}>
              {day(r.dueDate)}
              {r.overdue ? <span className="ms-1 text-xs">({tTable("overdue")})</span> : null}
            </TableCell>
            <TableCell className="text-end">
              <StatusBadge status={r.status} />
            </TableCell>
          </>
        )}
      </Section>

      <Section title={t("followUps.title")} description={t("followUps.description")} rows={data.followUps} groupName={groupName}>
        {(r) => (
          <>
            <Title href={r.href} title={r.title} sub={r.projectTitle} />
            <TableCell className={cn("text-end tabular-nums", r.overdue && "font-medium text-destructive")}>
              {r.dueAt ? day(r.dueAt) : t("followUps.noDate")}
              {r.overdue ? <span className="ms-1 text-xs">({tTable("overdue")})</span> : null}
            </TableCell>
          </>
        )}
      </Section>

      <Section title={t("meetings.title")} description={t("meetings.description", { days: TODAY_WINDOW_DAYS })} rows={data.meetings} groupName={groupName}>
        {(r) => (
          <>
            <Title href={r.href} title={r.title} sub={r.projectTitle} />
            <TableCell className="tabular-nums">
              <span className="flex flex-wrap items-center gap-2">
                {r.today ? <ToneBadge tone="new">{t("meetings.today")}</ToneBadge> : null}
                {when(r.startsAt)}
              </span>
            </TableCell>
            <TableCell className="text-end">
              <span className="inline-flex flex-wrap justify-end gap-2">
                {r.organizer ? <Badge variant="outline">{t("meetings.organizer")}</Badge> : null}
                <Badge variant={r.hasAgenda ? "secondary" : "outline"}>{r.hasAgenda ? t("meetings.agenda") : t("meetings.noAgenda")}</Badge>
              </span>
            </TableCell>
          </>
        )}
      </Section>

      <Section title={t("decisions.title")} description={t("decisions.description")} rows={data.decisions} groupName={groupName}>
        {(r) => (
          <>
            <Title
              href={r.href}
              title={r.kind === "join_request" ? t("decisions.joinTitle", { who: r.who ?? "—" }) : r.title}
              sub={r.projectTitle ?? undefined}
            />
            <TableCell>
              <ToneBadge tone="waiting">{t(`decisions.kinds.${r.kind}`)}</ToneBadge>
            </TableCell>
            <TableCell className="text-end text-xs text-muted-foreground tabular-nums">
              {r.kind === "deadline_request" && r.proposed
                ? t("decisions.proposed", { date: day(r.proposed), who: r.who ?? "—" })
                : r.kind === "closure_request" && r.who
                  ? t("decisions.askedBy", { who: r.who, date: day(r.at) })
                  : day(r.at)}
            </TableCell>
          </>
        )}
      </Section>

      <Section title={t("visits.title")} description={t("visits.description")} rows={data.visits.map((v) => ({ ...v, id: v.projectId }))} groupName={groupName}>
        {(r) => (
          <>
            <Title href={`/projects/${r.projectId}`} title={r.projectTitle} />
            <TableCell className="text-end text-sm tabular-nums">
              {t(r.firstVisit ? "visits.changedWeek" : "visits.changed", { count: r.changed })}
            </TableCell>
          </>
        )}
      </Section>
    </>
  );
}

/** A section with its count in the header and its rows under each client. Hidden when it has none. */
function Section<R extends { id: string; group: TodayGroup }>({
  title,
  description,
  rows,
  groupName,
  children,
}: {
  title: string;
  description: string;
  rows: R[];
  groupName: (g: TodayGroup) => string;
  children: (row: R) => ReactNode;
}) {
  if (!rows.length) return null;
  const groups = new Map<string, { group: TodayGroup; rows: R[] }>();
  for (const r of rows) {
    const key = `${r.group.internal ? "i" : "c"}:${r.group.id}`;
    groups.set(key, { group: r.group, rows: [...(groups.get(key)?.rows ?? []), r] });
  }
  // Clients by name, the firm's internal projects last.
  const ordered = [...groups.values()].sort(
    (a, b) => Number(a.group.internal) - Number(b.group.internal) || groupName(a.group).localeCompare(groupName(b.group)),
  );
  return (
    <section className="space-y-3">
      <SectionHeader title={title} description={description}>
        <Badge variant="secondary" className="tabular-nums">
          {rows.length}
        </Badge>
      </SectionHeader>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableBody>
            {ordered.map(({ group, rows: groupRows }) => [
              <TableRow key={`g-${group.id}`} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={4} className="py-2 text-xs font-medium text-muted-foreground">
                  {groupName(group)}
                </TableCell>
              </TableRow>,
              ...groupRows.map((r) => <TableRow key={r.id}>{children(r)}</TableRow>),
            ])}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Title({ href, title, sub }: { href: string; title: string; sub?: string }) {
  return (
    <TableCell className="max-w-80">
      <Link href={href} className="block truncate font-medium hover:underline">
        {title}
      </Link>
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </TableCell>
  );
}

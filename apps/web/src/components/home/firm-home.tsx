import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton } from "@/components/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import type { ActionStatus } from "@/authz";
import { REVIEW_WAIT_DAYS } from "@/lib/health";
import { ACTIONS_FILTERS, type HomeCounter, type HomeSection as SectionKey } from "@/lib/home";
import { cn } from "@/lib/utils";
import type { FirmHome } from "@/services/home";
import { TODAY_WINDOW_DAYS, type DecisionItem, type TodayGroup } from "@/services/today";
import { HomeRow, HomeSection, where } from "./home-section";

/**
 * The firm home (page audit 4.2): decisions waiting for me, then the admin's
 * messages from clients and the new inquiries, evidence waiting for my review,
 * late or due this week, my follow-ups, my meetings this week, what changed
 * since my last visit; then one line of counts that open the Actions filters.
 */
export async function FirmHomeLists({ data, open }: { data: FirmHome; open: SectionKey | null }) {
  const [t, tSteps, tHelp, tInbox, tTable, format, locale] = await Promise.all([
    getTranslations("home.firm"),
    getTranslations("home.steps"),
    getTranslations("help.support"),
    getTranslations("inbox"),
    getTranslations("table"),
    getFormatter(),
    getLocale(),
  ]);
  const tHome = await getTranslations("home");
  const ar = locale === "ar";
  const client = (g: TodayGroup) => (g.internal ? tHome("internal") : ((ar ? g.nameAr : null) ?? g.name));
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const when = (d: Date) => format.dateTime(d, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const decisionStep: Record<DecisionItem["kind"], string> = {
    join_request: tSteps("decide"),
    deadline_request: tSteps("decide"),
    closure_request: tSteps("decide"),
    info_request: tSteps("look"),
    deliverable_comment: tSteps("read"),
    disputed: tSteps("answer"),
    ready_to_close: tSteps("close"),
  };
  const decisionFact = (r: DecisionItem) =>
    r.kind === "deadline_request" && r.proposed
      ? t("decisions.proposed", { date: day(r.proposed), who: r.who ?? "—" })
      : r.kind === "closure_request" && r.who
        ? t("decisions.askedBy", { who: r.who, date: day(r.at) })
        : r.kind === "deliverable_comment" && r.who
          ? t("decisions.commentedBy", { who: r.who, date: day(r.at) })
          : r.kind === "disputed"
            ? t("decisions.disputedSince", { date: day(r.at) })
            : r.kind === "ready_to_close"
              ? t("decisions.closingSince", { date: day(r.at) })
              : day(r.at);

  const waiting =
    data.decisions.length +
    data.problems.length +
    data.inquiries.length +
    data.reviews.length +
    data.due.length +
    data.followUps.length +
    data.meetings.length +
    data.visits.length;

  const counters: { key: HomeCounter; label: string; n: number }[] = [
    { key: "late", label: t("counters.late"), n: data.counters.late },
    { key: "awaitingReview", label: t("counters.awaitingReview"), n: data.counters.awaitingReview },
    { key: "reviewWaiting", label: t("counters.reviewWaiting", { days: REVIEW_WAIT_DAYS }), n: data.counters.reviewWaiting },
    { key: "blocked", label: t("counters.blocked"), n: data.counters.blocked },
  ];

  return (
    <>
      <HomeSection
        id="decisions"
        title={t("decisions.title")}
        description={t("decisions.description")}
        open={open === "decisions"}
        rows={data.decisions.map((r) => (
          <HomeRow
            key={`${r.kind}-${r.id}`}
            href={r.href}
            title={r.kind === "join_request" ? t("decisions.joinTitle", { who: r.who ?? "—" }) : r.title}
            sub={where(r.projectTitle ?? client(r.group), r.projectTitle ? client(r.group) : null)}
            meta={
              <>
                <ToneBadge tone="waiting">{t(`decisions.kinds.${r.kind}`)}</ToneBadge>
                <span>{decisionFact(r)}</span>
              </>
            }
            step={decisionStep[r.kind]}
          />
        ))}
      />

      {data.admin ? (
        <HomeSection
          id="problems"
          title={tHelp("title")}
          description={tHelp("description")}
          open={open === "problems"}
          rows={data.problems.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground"> · {(ar ? r.orgNameAr : null) ?? r.orgName} · </span>
                  <a href={`mailto:${r.email}`} className="text-primary hover:underline">
                    <bdi dir="ltr">{r.email}</bdi>
                  </a>
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                  {r.can.handle ? <ApiButton endpoint={`/api/support-requests/${r.id}/handle`} label={tHelp("handle")} variant="outline" size="sm" /> : null}
                </div>
              </div>
              <p className="max-w-3xl whitespace-pre-wrap" dir="auto">
                {r.body}
              </p>
            </li>
          ))}
          after={
            data.handledProblems.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t("problems.handled", { n: data.handledProblems.length })}</summary>
                <ul className="mt-2 divide-y overflow-hidden rounded-xl border bg-card">
                  {data.handledProblems.map((r) => (
                    <li key={r.id} className="space-y-1 px-4 py-3">
                      <p className="text-xs text-muted-foreground">
                        {r.name} · {(ar ? r.orgNameAr : null) ?? r.orgName} · {format.dateTime(r.createdAt, { dateStyle: "medium" })} · {tHelp("handled")}
                      </p>
                      <p className="max-w-3xl whitespace-pre-wrap" dir="auto">
                        {r.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null
          }
        />
      ) : null}

      <HomeSection
        id="inquiries"
        title={t("inquiries.title")}
        description={t("inquiries.description")}
        count={t("inquiries.unread", { n: data.inquiries.length })}
        open={open === "inquiries"}
        rows={data.inquiries.map((r) => (
          <HomeRow
            key={r.id}
            href={`/inquiries/${r.id}`}
            title={(ar ? r.orgNameAr : null) ?? r.orgName ?? r.publicRef}
            sub={
              <>
                <bdi dir="ltr">{r.publicRef}</bdi>
                {r.source !== "website" ? ` · ${tInbox(`sources.${r.source}`)}` : null}
              </>
            }
            meta={<span>{t("inquiries.received", { date: day(r.createdAt) })}</span>}
            step={tSteps("open")}
          />
        ))}
      />

      <HomeSection
        id="reviews"
        title={t("reviews.title")}
        description={t("reviews.description")}
        open={open === "reviews"}
        rows={data.reviews.map((r) => (
          <HomeRow
            key={r.id}
            href={r.href}
            title={r.title}
            sub={where(r.projectTitle, client(r.group))}
            meta={
              <>
                <span>{r.ownerName ?? tTable("unassigned")}</span>
                {r.since ? <span>{t("reviews.since", { date: day(r.since) })}</span> : null}
              </>
            }
            step={tSteps("review")}
          />
        ))}
      />

      <HomeSection
        id="due"
        title={t("due.title")}
        description={t("due.description", { days: TODAY_WINDOW_DAYS })}
        open={open === "due"}
        rows={data.due.map((r) => (
          <HomeRow
            key={r.id}
            href={r.href}
            title={r.title}
            sub={where(r.projectTitle, client(r.group))}
            meta={
              <>
                <span>{r.ownerName ?? tTable("unassigned")}</span>
                <span className={cn(r.overdue && "font-medium text-destructive")}>
                  {day(r.dueDate)}
                  {r.overdue ? <span className="ms-1">({tTable("overdue")})</span> : null}
                </span>
                <StatusBadge status={r.status as ActionStatus} />
              </>
            }
            step={tSteps("open")}
          />
        ))}
      />

      <HomeSection
        id="followUps"
        title={t("followUps.title")}
        description={t("followUps.description")}
        open={open === "followUps"}
        rows={data.followUps.map((r) => (
          <HomeRow
            key={r.id}
            href={r.href}
            title={r.title}
            sub={where(r.projectTitle, client(r.group))}
            meta={
              <span className={cn(r.overdue && "font-medium text-destructive")}>
                {r.dueAt ? day(r.dueAt) : t("followUps.noDate")}
                {r.overdue ? <span className="ms-1">({tTable("overdue")})</span> : null}
              </span>
            }
            step={tSteps("open")}
          />
        ))}
      />

      <HomeSection
        id="meetings"
        title={t("meetings.title")}
        description={t("meetings.description", { days: TODAY_WINDOW_DAYS })}
        open={open === "meetings"}
        rows={data.meetings.map((r) => (
          <HomeRow
            key={r.id}
            href={r.href}
            title={r.title}
            sub={where(r.projectTitle, client(r.group))}
            meta={
              <>
                {r.today ? <ToneBadge tone="new">{t("meetings.today")}</ToneBadge> : null}
                <span>{when(r.startsAt)}</span>
                {r.organizer ? <Badge variant="outline">{t("meetings.organizer")}</Badge> : null}
                {r.hasAgenda ? null : <Badge variant="outline">{t("meetings.noAgenda")}</Badge>}
              </>
            }
            step={tSteps("open")}
          />
        ))}
      />

      <HomeSection
        id="visits"
        title={t("visits.title")}
        description={t("visits.description")}
        open={open === "visits"}
        rows={data.visits.map((r) => (
          <HomeRow
            key={r.projectId}
            href={`/projects/${r.projectId}`}
            title={r.projectTitle}
            sub={client(r.group)}
            meta={<span>{t(r.firstVisit ? "visits.changedWeek" : "visits.changed", { count: r.changed })}</span>}
            step={tSteps("open")}
          />
        ))}
      />

      {waiting === 0 ? <p className="text-sm text-muted-foreground">{tHome("nothingWaits")}</p> : null}

      {/* The four counters as one line (decision D5: counts, never a health word), each opening its Actions filter. */}
      <nav aria-label={t("counters.label")} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-surface px-4 py-3 text-sm text-surface-foreground">
        <span className="text-muted-foreground">{t("counters.label")}</span>
        {counters.map((c) => (
          <Link
            key={c.key}
            href={ACTIONS_FILTERS[c.key]}
            aria-label={t("counters.open", { label: `${c.n} ${c.label}` })}
            className="inline-flex items-baseline gap-2 rounded-md hover:underline"
          >
            <span className="text-lg font-semibold tabular-nums">{c.n}</span>
            <span className="text-muted-foreground">{c.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}


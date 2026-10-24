import { Flag, RotateCcw, Send, UserCheck } from "lucide-react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { Lock } from "@/components/animate-ui/icons/lock";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { ExportButton } from "@/components/export-button";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { SectionHeader } from "@/components/section-header";
import { StatusBadge } from "@/components/status-badge";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/env";
import { BLOCKER_KINDS, CLOSURE_LIMITS, DISPOSITIONS, type Disposition } from "@/lib/closure";
import type { ClosureView } from "@/services/closure";

const DISPOSITION_TONE: Record<Disposition, Tone> = { handed_over: "active", deferred: "open", withdrawn: "neutral", waived: "neutral" };

/**
 * The Closing tab (baseline: Closing, 0020): where closing stands, what is
 * left to settle, the decision on each open action, the firm's lessons and
 * the client's request to close. Every button is one the database will take.
 */
export async function ClosureTab({
  projectId,
  data,
  caseStudyNotAsked = false,
}: {
  projectId: string;
  data: ClosureView;
  /** No case-study consent recorded yet (F37): said while closing, never a blocker. */
  caseStudyNotAsked?: boolean;
}) {
  const t = await getTranslations("closure");
  const format = await getFormatter();
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const base = `/api/projects/${projectId}/closure`;
  const firm = data.firm;
  const closing = data.state === "closing";
  const closed = data.state === "closed";

  const counts = new Map<string, number>();
  for (const b of data.blockers) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
  const people = [
    ...data.people.map((p) => ({ value: `user:${p.id}`, label: p.name })),
    ...data.contacts.map((c) => ({ value: `contact:${c.id}`, label: t("contactSuffix", { name: c.name }) })),
  ];
  const sustainerChoices = [{ value: "later", label: t("sustainerLater") }, ...people];
  const choiceOf = (s: (typeof data.items)[number]["sustainer"]) =>
    s?.userId ? `user:${s.userId}` : s?.contactId ? `contact:${s.contactId}` : "later";

  const hint = closed
    ? t("hintClosed")
    : closing
      ? firm
        ? data.can.close
          ? t("hintClosing")
          : t("hintClosingLead")
        : t("hintClosingClient")
      : data.can.start || firm
        ? data.kind === "internal"
          ? t("hintActiveInternal")
          : t("hintActive")
        : t("hintActiveClient");

  return (
    <div className="space-y-6">
      <Card className="gap-4 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{hint}</CardDescription>
          <CardAction className="flex flex-wrap gap-2">
            {data.can.request ? (
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    <Send />
                    {t("request.ask")}
                  </Button>
                }
                title={t("request.askTitle")}
                description={t("request.askHint")}
                endpoint={`${base}/request`}
                fields={[{ name: "note", label: t("request.note"), type: "textarea", maxLength: CLOSURE_LIMITS.note }]}
                submitLabel={t("request.send")}
              />
            ) : null}
            {data.can.start ? <ApiButton endpoint={base} body={{ step: "start" }} label={t("start")} icon={<Flag />} confirm={t("startConfirm")} /> : null}
            {data.can.cancel ? <ApiButton endpoint={base} body={{ step: "cancel" }} label={t("cancel")} variant="ghost" confirm={t("cancelConfirm")} /> : null}
            {data.can.close && data.blockers.length === 0 ? (
              <ApiButton endpoint={base} body={{ step: "close" }} label={t("close")} variant="default" icon={<Lock />} confirm={t("closeConfirm")} />
            ) : null}
            {closed && env().PDF_SERVICE_URL ? <ExportButton endpoint={`${base}/report`} label={t("reportPdf")} title={t("report")} /> : null}
            {data.can.reopen ? (
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    <RotateCcw />
                    {t("reopen")}
                  </Button>
                }
                title={t("reopenTitle")}
                description={t("reopenHint")}
                endpoint={base}
                extra={{ step: "reopen" }}
                fields={[{ name: "reason", label: t("reason"), type: "textarea", required: true, maxLength: CLOSURE_LIMITS.reason.max }]}
                submitLabel={t("reopen")}
              />
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4 px-5">
          {data.current ? (
            <p className="text-sm text-muted-foreground">
              {/* A client may not see who at the firm did it; then only the date. */}
              {data.current.closedAt
                ? data.current.closedBy
                  ? t("closedBy", { date: day(data.current.closedAt), who: data.current.closedBy })
                  : t("closedOn", { date: day(data.current.closedAt) })
                : data.current.startedBy
                  ? t("startedBy", { date: day(data.current.startedAt), who: data.current.startedBy })
                  : t("startedOn", { date: day(data.current.startedAt) })}
            </p>
          ) : null}

          {data.request ? <RequestNote data={data} projectId={projectId} /> : null}

          {closing && firm ? (
            data.blockers.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <CircleCheck className="size-4 text-success" />
                {data.can.close ? t("readyToClose") : t("readyForAdmin")}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("left", { n: data.blockers.length })}</p>
                <ul className="divide-y rounded-lg border text-sm">
                  {BLOCKER_KINDS.filter((k) => counts.has(k)).map((k) => (
                    <li key={k} className="flex items-center gap-3 px-3 py-2">
                      <ToneBadge tone="waiting">{counts.get(k)}</ToneBadge>
                      <span>{t(`blocker.${k}`, { n: counts.get(k)! })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
          {closing && firm && caseStudyNotAsked ? <p className="text-xs text-muted-foreground">{t("caseStudyNotAsked")}</p> : null}
        </CardContent>
      </Card>

      {closing || closed ? (
        <section className="space-y-3">
          <SectionHeader title={t("openActions")} description={firm ? t("openActionsHint") : t("openActionsClient")} />
          {data.items.length === 0 ? (
            <EmptyState icon={<CircleCheck animateOnView />} description={t("noOpen")} className="py-6 md:py-6" />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colAction")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                    <TableHead>{t("colDecision")}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((i) => (
                    <TableRow key={i.actionId}>
                      <TableCell className="max-w-80 whitespace-normal">
                        <p className="font-medium" dir="auto">
                          {i.title}
                        </p>
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {i.recommendation}
                          {i.owner ? ` · ${i.owner}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={i.status} />
                      </TableCell>
                      <TableCell className="max-w-72 space-y-1 whitespace-normal">
                        {i.disposition ? (
                          <>
                            <ToneBadge tone={DISPOSITION_TONE[i.disposition]}>{t(`dispositions.${i.disposition}`)}</ToneBadge>
                            {i.disposition === "handed_over" ? (
                              <p className={i.sustainer ? "text-xs" : "text-xs text-destructive"} dir="auto">
                                {i.sustainer ? t("sustainedBy", { name: i.sustainer.name ?? t("someone") }) : t("noSustainer")}
                              </p>
                            ) : null}
                            {i.note ? (
                              <p className="text-xs whitespace-pre-wrap text-muted-foreground" dir="auto">
                                {i.note}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <ToneBadge tone="waiting">{t("undecided")}</ToneBadge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {data.can.dispose ? (
                            <FormDialog
                              trigger={
                                <Button size="sm" variant={i.disposition ? "ghost" : "outline"}>
                                  {i.disposition ? t("change") : t("decide")}
                                </Button>
                              }
                              title={t("decideTitle")}
                              description={`${i.title} · ${t("decideHint")}`}
                              endpoint={`${base}/items/${i.actionId}`}
                              method="PUT"
                              fields={[
                                {
                                  name: "disposition",
                                  label: t("disposition"),
                                  type: "select",
                                  required: true,
                                  defaultValue: i.disposition ?? "handed_over",
                                  options: DISPOSITIONS.map((d) => ({ value: d, label: `${t(`dispositions.${d}`)}: ${t(`dispositionHints.${d}`)}` })),
                                },
                                ...(people.length
                                  ? [{ name: "sustainer", label: t("sustainer"), type: "select" as const, defaultValue: choiceOf(i.sustainer), options: sustainerChoices }]
                                  : []),
                                { name: "note", label: t("note"), type: "textarea" as const, maxLength: CLOSURE_LIMITS.note, defaultValue: i.note ?? undefined, placeholder: t("noteRequired") },
                              ]}
                              submitLabel={t("decide")}
                            />
                          ) : data.can.nameSustainer && i.disposition === "handed_over" && people.length ? (
                            <FormDialog
                              trigger={
                                <Button size="sm" variant={i.sustainer ? "ghost" : "outline"}>
                                  <UserCheck />
                                  {t("nameSustainer")}
                                </Button>
                              }
                              title={t("nameTitle")}
                              description={`${i.title} · ${t("nameHint")}`}
                              endpoint={`${base}/items/${i.actionId}`}
                              method="PATCH"
                              fields={[{ name: "sustainer", label: t("sustainer"), type: "select", required: true, defaultValue: choiceOf(i.sustainer), options: sustainerChoices }]}
                              submitLabel={t("nameSustainer")}
                            />
                          ) : null}
                          {data.can.dispose && i.disposition ? (
                            <ApiButton endpoint={`${base}/items/${i.actionId}`} method="DELETE" label={t("clearDecision")} variant="ghost" confirm={t("clearConfirm")} />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}

      {(closing || closed) && firm ? (
        <section className="space-y-3">
          <SectionHeader
            title={t("lessons")}
            description={
              <span className="inline-flex items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <Lock className="size-3" />
                  {t("firmOnly")}
                </Badge>
                {t("lessonsHint")}
              </span>
            }
          >
            {data.can.lessons ? (
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    {data.lessons ? t("editLessons") : t("writeLessons")}
                  </Button>
                }
                title={t("lessons")}
                description={t("lessonsHint")}
                endpoint={`${base}/lessons`}
                method="PUT"
                fields={[
                  { name: "wentWell", label: t("wentWell"), type: "textarea", required: true, maxLength: CLOSURE_LIMITS.lessons, defaultValue: data.lessons?.wentWell },
                  { name: "toImprove", label: t("toImprove"), type: "textarea", required: true, maxLength: CLOSURE_LIMITS.lessons, defaultValue: data.lessons?.toImprove },
                  { name: "nextTime", label: t("nextTime"), type: "textarea", maxLength: CLOSURE_LIMITS.lessons, defaultValue: data.lessons?.nextTime ?? undefined },
                ]}
                submitLabel={t("writeLessons")}
              />
            ) : null}
          </SectionHeader>
          {data.lessons ? (
            <dl className="grid gap-4 rounded-xl border bg-card p-5 text-sm shadow-xs md:grid-cols-3">
              {(
                [
                  ["wentWell", data.lessons.wentWell],
                  ["toImprove", data.lessons.toImprove],
                  ["nextTime", data.lessons.nextTime],
                ] as const
              ).map(([k, v]) =>
                v ? (
                  <div key={k} className="space-y-1">
                    <dt className="text-xs text-muted-foreground">{t(k)}</dt>
                    <dd className="whitespace-pre-wrap" dir="auto">
                      {v}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : (
            <EmptyState description={t("noLessons")} className="py-6 md:py-6" />
          )}
        </section>
      ) : null}

      {data.history.length ? (
        <section className="space-y-3">
          <SectionHeader title={t("history")} />
          <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
            {data.history.map((h, n) => (
              <li key={n} className="space-y-1 px-4 py-3">
                <p>
                  {h.reopenedAt
                    ? t("historyReopened", { closed: h.closedAt ? day(h.closedAt) : "—", reopened: day(h.reopenedAt), who: h.reopenedBy ?? t("someone") })
                    : t("historyCancelled", { start: day(h.startedAt), end: h.cancelledAt ? day(h.cancelledAt) : "—" })}
                </p>
                {h.reopenReason ? (
                  <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
                    {h.reopenReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The client's latest request to close, and the firm's answer. */
async function RequestNote({ data, projectId }: { data: ClosureView; projectId: string }) {
  const t = await getTranslations("closure.request");
  const format = await getFormatter();
  const r = data.request!;
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const client = !data.firm;
  const line =
    r.status === "pending"
      ? client
        ? t("pendingClient", { date: day(r.createdAt) })
        : t("pending", { who: r.requestedBy ?? t("someoneAtClient"), date: day(r.createdAt) })
      : r.status === "declined"
        ? t("declined", { date: day(r.decidedAt ?? r.createdAt) })
        : t("accepted", { date: day(r.decidedAt ?? r.createdAt) });
  return (
    <div className="space-y-2 rounded-lg border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <ToneBadge tone={r.status === "pending" ? "waiting" : "neutral"}>{line}</ToneBadge>
        </span>
        {data.can.decline ? (
          <FormDialog
            trigger={
              <Button size="sm" variant="ghost">
                {t("decline")}
              </Button>
            }
            title={t("declineTitle")}
            description={t("declineHint")}
            endpoint={`/api/projects/${projectId}/closure/request/${r.id}`}
            method="PATCH"
            fields={[{ name: "reply", label: t("reply"), type: "textarea", required: true, maxLength: CLOSURE_LIMITS.reply.max }]}
            submitLabel={t("decline")}
          />
        ) : null}
      </div>
      {r.note ? (
        <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
          {r.note}
        </p>
      ) : null}
      {r.reply ? (
        <p className="whitespace-pre-wrap" dir="auto">
          <span className="text-xs text-muted-foreground">{t("reply")}: </span>
          {r.reply}
        </p>
      ) : null}
    </div>
  );
}

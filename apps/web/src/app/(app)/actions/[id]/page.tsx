import { ArrowLeft, ArrowRightLeft, ClipboardPen, MailWarning, UserRoundCog } from "lucide-react";
import { VerifiedBurst } from "@/components/verified-burst";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { RotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { CircleX } from "@/components/animate-ui/icons/circle-x";
import { Lock } from "@/components/animate-ui/icons/lock";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AskAbout } from "@/components/ask-about";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nextStep } from "@/lib/action-next";
import { actionPageCards, plainDateLines } from "@/lib/action-plain";
import { firmRun } from "@/lib/engagement";
import { isUuid } from "@/lib/ids";
import { localLabel } from "@/lib/names";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { ownerControl } from "@/services/action-owner";
import { actionThread } from "@/services/comments";
import { departmentChoices } from "@/services/engagement";
import { actionClosure, actionFollowThrough, actionLadder, listActionNotes, mailFailing } from "@/services/follow-through";
import { isActionMuted } from "@/services/notifications";
import { getActionDetail } from "@/services/queries";
import { actionSlip } from "@/services/slips";
import { askMentionFor } from "@/services/help";
import { actionSecondReview } from "@/services/second-review";
import { ActionPanel } from "./action-panel";
import { ActionPageMenu, PlainDateLines } from "./client-view";
import { CommentThread } from "./comment-thread";
import { RiskAcceptances } from "./closure-panels";
import { DownloadButton } from "./download-button";
import { DepartmentPicker } from "./department-picker";
import { DeadlineRequests } from "./follow-through-panels";
import { OwnerChange } from "./owner-change";
import { ReminderLadder } from "./reminder-ladder";
import { SecondReviewCard, SecondReviewStatus } from "./second-review";
import { WhatToSend } from "./what-to-send";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The action page (page audit 4.5, batch 4): one page, the same order for
// the owner, the manager and the reviewer; what differs is the first card.
// 1 the header (title, state, due date), 2 what happened last, 3 what waits
// and on whom (one solid button), 4 what to send, 5 one way to send a file
// (the one dialog), 6 one conversation, 7 the history, 8 the side panel.
export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, follow, closing, depts, firmView, notes, ladder, muted, failing, thread, slip, leads, second, me, owner } = await withPrincipal(
    async (tx, principal) => {
      const data = await getActionDetail(tx, principal, id);
      return {
        me: principal.userId,
        ladder: await actionLadder(tx, principal, id),
        muted: await isActionMuted(tx, principal, id),
        // Firm staff see when mail to the owner isn't getting through.
        failing: data.action.ownerUserId ? ((await mailFailing(tx, principal, [data.action.ownerUserId])).get(data.action.ownerUserId) ?? null) : null,
        data,
        firmView: principal.orgKind === "firm",
        follow: await actionFollowThrough(tx, principal, id),
        closing: await actionClosure(tx, principal, id),
        // Firm-only notes; anyone who may not read them (every client role) gets null.
        notes: await listActionNotes(tx, principal, id).catch(() => null),
        thread: await actionThread(tx, principal, id),
        // Client side: whom "Ask the consultant" mentions (F13).
        leads: await askMentionFor(tx, principal),
        slip: await actionSlip(tx, data.action.projectId, id),
        // Whether this work needs a second consultant's sign-off, and where the round stands (F22).
        second: await actionSecondReview(tx, principal, id),
        // Internal projects have no departments.
        depts: data.context.projectKind === "client" ? await departmentChoices(tx, principal, data.action.orgId) : null,
        // Giving it to a colleague (D1), for those the database allows.
        owner: await ownerControl(tx, principal, id),
      };
    },
  );
  const [t, tc, tTable, tEng, tMode, tVis, tLast, format] = await Promise.all([
    getTranslations("action"),
    getTranslations("common"),
    getTranslations("table"),
    getTranslations("engagement.departments"),
    getTranslations("engagement"),
    getTranslations("visibility"),
    getTranslations("action.last"),
    getFormatter(),
  ]);
  const dept = depts?.departments.find((d) => d.id === data.action.departmentId) ?? null;
  // Shown while the client uses departments, or while the action is still filed under one.
  const showDept = !!depts && (depts.enabled || !!dept);
  const ar = (await getLocale()) === "ar";
  const { action, context } = data;
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const dayOf = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  // A client the firm runs has no accounts: the firm records its work, and says how and when the client sent each piece (N24).
  const recordedForClient = firmRun(context.projectKind, context.engagementMode);
  const received = (r: { source: string; receivedVia: string | null; receivedOn: string | null }) =>
    r.source === "consultant_recorded" && r.receivedOn
      ? t("received", { via: r.receivedVia ?? "other", date: format.dateTime(new Date(`${r.receivedOn}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) })
      : null;
  // The first of the client's lead and deputy who can see this action.
  const askMention = leads?.find((u) => thread.people.some((p) => p.id === u)) ?? null;
  // A client reader does not get the firm's machinery (page audit 4.5): no reminder ladder, no date
  // history, no sign-off count; two plain lines say what is expected next and what happened last.
  const cards = actionPageCards(firmView);
  const plain = firmView
    ? null
    : plainDateLines({
        status: action.status,
        dueDate: action.dueDate,
        overdue: action.overdue,
        ladder,
        requests: follow.deadlines,
        moves: slip.history,
        readerId: me,
      });

  // The one card (page audit 4.5, block 3), from what the server allows this reader.
  const waitingItems = follow.items.filter((i) => i.status === "open" || i.status === "rejected");
  const submittedItems = follow.items.filter((i) => i.status === "submitted");
  const pending = follow.deadlines.find((d) => d.status === "pending") ?? null;
  const finished = action.status === "verified_complete" || action.status === "closed";
  const plan = nextStep({
    status: action.status,
    moves: data.moves,
    canSubmitEvidence: data.can.submitEvidence,
    canRequestDate: follow.can.requestDeadline,
    canAsk: thread.can.write && !finished,
    canSignRisk: closing.can.sign,
    canMute: true,
    firm: firmView,
    second: second ? { required: second.required, signed: !!second.signoff, canSignOff: second.can.signOff, canVerify: second.can.verify } : null,
    dateToDecide: !!pending && follow.can.decideDeadline,
    items: { open: waitingItems.length, submitted: submittedItems.length },
  });
  // The reader may send it for review now: from work in progress, or in one step from a sent-back action.
  const canReview = plan.main === "send" || plan.main === "resend";
  // The files of the round under review: what was sent since the last decision.
  const lastDecision = data.timeline.findIndex((e) => e.kind === "review");
  const judged = data.timeline
    .slice(0, lastDecision === -1 ? undefined : lastDecision)
    .flatMap((e) => (e.kind === "evidence" ? [{ documentId: e.evidence.documentId, title: e.evidence.documentTitle, canDownload: e.evidence.canDownload }] : []));
  // Progress notes are part of the conversation (block 6); the history keeps files and decisions (block 7).
  const progressNotes = data.timeline.flatMap((e) =>
    e.kind === "update"
      ? [
          {
            id: e.id,
            at: e.at,
            who: e.who,
            received: received(e),
            body: <Translatable entityType="progress_update" entityId={e.id} field="body" text={e.body} canReview={data.firmStaff} className="text-sm" />,
          },
        ]
      : [],
  );
  const timeline = data.timeline.filter((e) => e.kind !== "update" && (cards.signOffs || e.kind !== "signoff"));
  // Given to the reader (decision D1): said once, as what happened last.
  const latestHandover = data.timeline.find((e) => e.kind === "owner");
  const givenToMe = latestHandover?.kind === "owner" && latestHandover.toUserId === me && action.ownerUserId === me && !finished ? latestHandover : null;

  const last: { key: string; node: ReactNode }[] = [];
  if (action.sentBack) {
    last.push({
      key: "sentBack",
      node: (
        <>
          <p className="font-medium">{action.sentBack.by ? tLast("sentBackBy", { who: action.sentBack.by, date: when(action.sentBack.at) }) : tLast("sentBack")}</p>
          {action.sentBack.reason ? (
            <p className="whitespace-pre-wrap" dir="auto">
              {action.sentBack.reason}
            </p>
          ) : null}
        </>
      ),
    });
  }
  if (givenToMe?.kind === "owner") {
    last.push({ key: "given", node: <p>{givenToMe.who ? tLast("givenToYouBy", { who: givenToMe.who, date: when(givenToMe.at) }) : tLast("givenToYou", { date: when(givenToMe.at) })}</p> });
  }

  return (
    <>
      <Link href="/actions" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader
        title={action.title}
        morph={`action-${action.id}`}
        meta={
          <>
            <VerifiedBurst actionId={action.id} verified={action.status === "verified_complete"}>
              <StatusBadge
                status={action.status}
                reader={firmView ? "firm" : "client"}
                exact
                outcome={closing.closure?.outcome ? t(`closure.outcomes.${closing.closure.outcome}`) : null}
              />
            </VerifiedBurst>
            {action.dueDate && !finished ? (
              <span className={cn("text-sm tabular-nums", action.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                {action.overdue ? t("dueLate", { date: dayOf(action.dueDate) }) : t("dueOn", { date: dayOf(action.dueDate) })}
              </span>
            ) : null}
          </>
        }
      >
        {data.askAssistant ? <AskAbout projectId={action.projectId} type="action" id={action.id} /> : null}
        {/* The rare things (close, reopen, the company accepts the risk, mail) are one menu for every reader. */}
        <ActionPageMenu
          actionId={action.id}
          items={plan.menu}
          muted={muted}
          close={closing.can.close ? { signed: closing.signed, replacements: closing.replacements } : null}
        />
      </PageHeader>
      {recordedForClient ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <ClipboardPen className="size-4" />
          {tMode("recordsForClient")}
        </p>
      ) : null}
      {/* The firm's draft (D6): the client sees it, and its thread, only once it is released. Someone who
          cannot release it (an observer) is not told "until you release it". */}
      {firmView && action.status === "draft" ? (
        <p className="text-sm text-muted-foreground">{t(data.moves.includes("assigned") ? "draftNotice" : "draftNoticeReader")}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {/* 2. What happened last, only when it applies. */}
          {closing.replaces.length ? (
            <p className="text-sm text-muted-foreground">
              {t("closure.replaces")}:{" "}
              {closing.replaces.map((x, i) => (
                <span key={x.id}>
                  {i ? " · " : ""}
                  <Link href={`/actions/${x.id}`} className="text-primary hover:underline" dir="auto">
                    {x.title}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          {closing.closure ? (
            <div className="space-y-1 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-medium">
                {t("closure.closedAs", { outcome: t(`closure.outcomes.${closing.closure.outcome ?? "not_applicable"}`) })}
              </p>
              {closing.closure.note ? <p className="whitespace-pre-wrap">{closing.closure.note}</p> : null}
              {closing.closure.supersededBy ? (
                <p>
                  {t("closure.replacedBy")}:{" "}
                  <Link href={`/actions/${closing.closure.supersededBy.id}`} className="text-primary hover:underline">
                    {closing.closure.supersededBy.title}
                  </Link>
                </p>
              ) : null}
              {closing.closure.at ? (
                <p className="text-xs text-muted-foreground">
                  {closing.closure.by ? t("closure.by", { name: closing.closure.by, date: when(closing.closure.at) }) : when(closing.closure.at)}
                </p>
              ) : null}
            </div>
          ) : null}
          {last.map((l) => (
            <div key={l.key} className="space-y-1 rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-slot="what-happened-last">
              {l.node}
            </div>
          ))}

          {/* 3. What waits, and on whom. */}
          <ActionPanel
            actionId={action.id}
            status={action.status}
            plan={plan}
            waitingItems={waitingItems.map((i) => ({ id: i.id, title: i.title }))}
            judged={judged}
            toAccept={submittedItems.length}
            firmView={firmView}
            recordFor={firmView && recordedForClient}
            ownerGone={data.ownerGone}
            blockedReason={action.blockedReason}
            awaitingSince={action.awaitingSince}
            reviewers={firmView ? data.reviewers.filter((r) => r.id !== me).map((r) => r.name) : null}
            date={
              pending && follow.can.decideDeadline
                ? {
                    id: pending.id,
                    proposedDueDate: pending.proposedDueDate,
                    reason: pending.reason,
                    requestedBy: pending.requestedBy,
                    // Approving would move the date later once too often for this person (app_can_extend).
                    needsLead: !slip.canExtend && (!action.dueDate || pending.proposedDueDate > action.dueDate),
                  }
                : null
            }
            dueDate={action.dueDate}
            after={
              <>
                {/* The sign-off count is the firm's machinery: not drawn for a client reader (page audit 4.5). */}
                {action.status === "awaiting_review" && second && firmView ? <SecondReviewStatus view={second} firmView={firmView} /> : null}
                {plain ? <PlainDateLines next={plain.next} last={plain.last} /> : null}
              </>
            }
          />

          {/* 4. What to send: the description, what shows it is done, and the evidence list. */}
          <WhatToSend
            actionId={action.id}
            description={
              action.description ? (
                <Translatable entityType="action" entityId={action.id} field="description" text={action.description} canReview={data.firmStaff} className="max-w-3xl text-sm" />
              ) : null
            }
            requiredEvidence={context.requiredEvidence}
            items={follow.items}
            canManage={follow.can.manageItems}
            firmView={firmView}
            firmRun={recordedForClient}
            canSubmit={data.can.submitEvidence}
            canReview={canReview}
          />

          {/* 6. One conversation: the discussion and the progress notes, one box. */}
          <CommentThread
            actionId={action.id}
            comments={thread.comments}
            people={thread.people}
            canWrite={thread.can.write && !(finished && !firmView)}
            firmView={firmView}
            firmRun={recordedForClient}
            askMention={askMention}
            notes={progressNotes}
            progress={data.can.addUpdate && !finished ? { recordFor: firmView && recordedForClient } : null}
          />

          {notes ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {t("notes.title")}
                    <Badge variant="outline" className="gap-1">
                      <Lock className="size-3" />
                      {tVis("firm_private")}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{t("notes.hint")}</CardDescription>
                </div>
                <FormDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      {t("notes.add")}
                    </Button>
                  }
                  title={t("notes.add")}
                  description={t("notes.hint")}
                  endpoint={`/api/actions/${action.id}/notes`}
                  fields={[{ name: "body", label: t("notes.label"), type: "textarea", required: true, maxLength: 8000, placeholder: t("notes.placeholder") }]}
                  submitLabel={t("notes.add")}
                />
              </CardHeader>
              <CardContent className="px-5">
                {notes.length === 0 ? <p className="text-sm text-muted-foreground">{t("notes.none")}</p> : null}
                <ol className="space-y-4">
                  {notes.map((n) => (
                    <li key={n.id} className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium">{n.author}</span>{" "}
                        <span className="ms-1 text-xs text-muted-foreground tabular-nums">{when(n.at)}</span>
                      </p>
                      <p className="whitespace-pre-wrap" dir="auto">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          {/* 7. History: files and decisions, last. */}
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("history")}</CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              {timeline.length === 0 ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : null}
              <ol className="space-y-5">
                {timeline.map((e, i) => {
                  const Icon =
                    e.kind === "evidence"
                      ? FileText
                      : e.kind === "moved"
                        ? ArrowRightLeft
                        : e.kind === "owner"
                          ? UserRoundCog
                          : e.kind === "signoff"
                            ? CircleCheck
                            : e.kind === "review" && e.outcome === "accept"
                              ? CircleCheck
                              : e.kind === "review" && e.outcome === "revise"
                                ? RotateCcw
                                : CircleX;
                  const tone =
                    e.kind === "review" ? (e.outcome === "accept" ? "text-success" : "text-destructive") : "text-muted-foreground";
                  return (
                    <li key={i} className="flex gap-3">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
                      <div className="min-w-0 flex-1 space-y-1">
                        {/* "Event from person" in Arabic, so the line is right for anyone, man or woman; "Person did" in English. */}
                        <p className="text-sm text-muted-foreground">
                          {tc.rich("byLine", {
                            name: e.who ?? (e.kind === "review" ? t("firmReviewer") : t("someone")),
                            event:
                              e.kind === "moved"
                                ? t("entry.moved", {
                                    from: e.from ? localLabel(e.from, ar) : "—",
                                    to: e.to ? localLabel(e.to, ar) : "—",
                                  })
                                : e.kind === "owner"
                                  ? t("entry.owner", { to: e.to ?? "—" })
                                  : t(`entry.${e.kind === "review" ? e.outcome : e.kind}`),
                            who: (c) => <span className="font-medium text-foreground">{c}</span>,
                          })}
                          <span className="ms-2 text-xs tabular-nums">{when(e.at)}</span>
                        </p>
                        {e.kind === "review" && e.reason ? <p className="text-sm whitespace-pre-wrap">{e.reason}</p> : null}
                        {e.kind === "signoff" && e.note ? (
                          <p className="text-sm whitespace-pre-wrap" dir="auto">
                            {e.note}
                          </p>
                        ) : null}
                        {e.kind === "evidence" ? (
                          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                            <FileText className="size-4 text-muted-foreground" />
                            <span className="truncate text-sm">{e.evidence.documentTitle}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{fileSize(e.evidence.sizeBytes)}</span>
                            {e.evidence.canDownload ? <DownloadButton documentId={e.evidence.documentId} label={t("download")} unavailable={t("errors.unavailable")} /> : null}
                            {e.evidence.note ? <p className="w-full text-sm text-muted-foreground">{e.evidence.note}</p> : null}
                            {received(e.evidence) ? <p className="w-full text-xs text-muted-foreground">{received(e.evidence)}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* 8. The side panel: the facts; for the firm also its own cards. */}
        <div className="space-y-6">
          <Card className="h-fit gap-0 py-0 shadow-xs">
            <dl className="divide-y text-sm">
              {[
                [tTable("project"), <Link key="p" href={`/projects/${action.projectId}`} className="text-primary hover:underline">{context.projectTitle}</Link>],
                [t("recommendation"), context.recommendationTitle],
                [
                  t("owner"),
                  <span key="o" className="space-y-1">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span>{action.ownerName ?? tTable("unassigned")}</span>
                      {owner ? <OwnerChange actionId={action.id} projectId={action.projectId} control={owner} firmView={firmView} /> : null}
                    </span>
                    {failing ? (
                      <span className="flex items-center gap-1.5 text-xs text-destructive" title={t("mailFailingHint", { name: action.ownerName ?? "" })}>
                        <MailWarning className="size-3.5 shrink-0" />
                        {t("mailFailing")}
                      </span>
                    ) : null}
                  </span>,
                ],
                ...(showDept
                  ? [
                      [
                        tEng("department"),
                        data.can.fileDepartment && depts!.enabled ? (
                          <DepartmentPicker key="dp" actionId={action.id} value={action.departmentId} departments={depts!.departments} />
                        ) : dept ? (
                          localLabel(dept, ar)
                        ) : (
                          tEng("none")
                        ),
                      ] as const,
                    ]
                  : []),
                // The client's name, for the firm; a client reader is that client.
                ...(context.projectKind === "client" && firmView ? [[tTable("client"), (ar ? context.orgNameAr : null) ?? context.orgName] as const] : []),
              ].map(([k, v], i) => (
                <div key={i} className="space-y-1 px-5 py-3">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {cards.dateHistory ? (
            <DeadlineRequests
              actionId={action.id}
              dueDate={action.dueDate}
              requests={follow.deadlines}
              slip={slip}
              canRequest={follow.can.requestDeadline}
              canDecide={follow.can.decideDeadline}
            />
          ) : null}
          {/* A client the firm runs has none of the client roles the ladder names (N24). */}
          {cards.ladder && !recordedForClient ? <ReminderLadder running={ladder.running} steps={ladder.steps} /> : null}
          {cards.signOffs ? <SecondReviewCard actionId={action.id} view={second} /> : null}
          <RiskAcceptances items={closing.acceptances} firmView={firmView} />
        </div>
      </div>
    </>
  );
}

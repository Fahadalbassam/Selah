import { ArrowLeft, Ban, CalendarPlus, Pencil, Video } from "lucide-react";
import { Send } from "@/components/animate-ui/icons/send";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ApiButton } from "@/components/form-dialog";
import { MeetingForm } from "@/components/meeting-form";
import { PageHeader } from "@/components/page-header";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withPrincipal } from "@/server/page";
import { getMeeting, meetingInvitees } from "@/services/meetings";
import {
  AddAttendee,
  DecisionForm,
  FollowUpForm,
  FollowUpToggle,
  RemoveAttendee,
  RespondButtons,
  SummaryBlock,
} from "./record-panels";
import { SummarySources } from "./summary-sources";
import { TranscriptPanel } from "./transcript-panel";
import { ToneBadge } from "@/components/tone-badge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data, invitees, firm, started } = await withPrincipal(async (tx, principal) => {
    const data = await getMeeting(tx, principal, id);
    return {
      data,
      // Whoever runs the meeting can add people; roles that can't book get no list.
      invitees: data.canRun ? await meetingInvitees(tx, principal, data.meeting.projectId).catch(() => null) : null,
      firm: principal.orgKind === "firm",
      started: data.meeting.startsAt < new Date(),
    };
  });
  const [t, tr, tVis, format] = await Promise.all([
    getTranslations("meeting"),
    getTranslations("meeting.record"),
    getTranslations("visibility"),
    getFormatter(),
  ]);
  const { meeting, attendees, decisions, followUps, summary, sources, sourceFiles, transcript, canRun, canFollowUp, me } = data;
  const when = `${format.dateTime(meeting.startsAt, { dateStyle: "full", timeStyle: "short" })} – ${format.dateTime(meeting.endsAt, { timeStyle: "short" })}`;
  const scheduled = meeting.status === "scheduled";
  const held = meeting.status === "held";
  const shared = meeting.visibility === "shared";
  const lang: "ar" | "en" = meeting.spokenLang === "en" ? "en" : "ar";
  const mine = attendees.find((a) => a.userId === me && a.role !== "organizer");
  const replaced = new Set(decisions.map((d) => d.supersedesId).filter(Boolean));
  const decisionNo = new Map(decisions.map((d, i) => [d.id, i + 1]));
  const pickable = decisions.filter((d) => !replaced.has(d.id)).map((d) => ({ id: d.id, text: d.text }));
  const attending = new Set(attendees.flatMap((a) => [a.userId, a.contactId]).filter(Boolean));
  const addOptions = invitees
    ? [
        ...invitees.people
          .filter((p) => !attending.has(p.userId) && (shared || p.firm))
          .map((p) => ({ value: `u:${p.userId}`, label: p.name })),
        ...(shared ? invitees.contacts : [])
          .filter((c) => !attending.has(c.contactId))
          .map((c) => ({ value: `c:${c.contactId}`, label: `${c.name}${c.title ? ` · ${c.title}` : ""} (${t("contact")})` })),
      ]
    : [];

  return (
    <>
      <Link
        href={`/projects/${meeting.projectId}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader
        title={meeting.title}
        meta={
          <>
            <ToneBadge tone={meeting.status === "cancelled" ? "problem" : held ? "neutral" : "open"}>
              {t(`status.${meeting.status}`)}
            </ToneBadge>
            <Badge variant="outline">{t(`kinds.${meeting.kind}`)}</Badge>
            <Badge variant="outline">{tVis(meeting.visibility)}</Badge>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="gap-3 py-5 shadow-xs">
            <CardContent className="space-y-3 px-5 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="tabular-nums">{when}</span>
                {meeting.joinUrl && scheduled ? (
                  <Button asChild size="sm">
                    <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">
                      <Video />
                      {t("join")}
                    </a>
                  </Button>
                ) : null}
                {meeting.locationText ? <span className="text-muted-foreground">{meeting.locationText}</span> : null}
                {meeting.status !== "held" ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/meetings/${meeting.id}/ics`}>
                      <CalendarPlus />
                      {t("calendar")}
                    </a>
                  </Button>
                ) : null}
              </div>
              {canRun && meeting.status !== "held" ? (
                <div className="flex flex-wrap items-start gap-2 border-t pt-3">
                  {scheduled ? (
                    <MeetingForm
                      meetingId={meeting.id}
                      firm={firm}
                      initial={{
                        title: meeting.title,
                        startsAt: meeting.startsAt.toISOString(),
                        endsAt: meeting.endsAt.toISOString(),
                        location: meeting.location,
                        joinUrl: meeting.joinUrl,
                        locationText: meeting.locationText,
                        spokenLang: meeting.spokenLang as "ar" | "en" | "mixed",
                      }}
                      trigger={
                        <Button size="sm" variant="outline">
                          <Pencil />
                          {t("edit")}
                        </Button>
                      }
                    />
                  ) : null}
                  <ApiButton
                    endpoint={`/api/meetings/${meeting.id}/invites`}
                    label={scheduled ? t("sendInvites") : t("sendCancellation")}
                    icon={<Send />}
                    title={t("sendInvitesHint")}
                  />
                  {scheduled && started ? (
                    <ApiButton
                      endpoint={`/api/meetings/${meeting.id}`}
                      method="PATCH"
                      body={{ status: "held" }}
                      label={t("markHeld")}
                    />
                  ) : null}
                  {scheduled ? (
                    <ApiButton
                      endpoint={`/api/meetings/${meeting.id}`}
                      method="PATCH"
                      body={{ status: "cancelled" }}
                      label={t("cancelMeeting")}
                      icon={<Ban />}
                      variant="ghost"
                      confirm={t("cancelConfirm")}
                    />
                  ) : null}
                </div>
              ) : null}
              {mine && scheduled ? <RespondButtons meetingId={meeting.id} current={mine.response} /> : null}
            </CardContent>
          </Card>

          {meeting.agendaMd ? (
            <Card className="gap-3 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("agenda")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 px-5 text-sm" dir="auto">
                {/* The database writes it as "## heading" and "- item" lines. */}
                {meeting.agendaMd.split("\n").map((line, i) =>
                  line.startsWith("## ") ? (
                    <p key={i} className="pt-2 font-medium first:pt-0">
                      {line.slice(3)}
                    </p>
                  ) : line.startsWith("- ") ? (
                    <p key={i} className="ps-3 text-muted-foreground">
                      • {line.slice(2)}
                    </p>
                  ) : line ? (
                    <p key={i}>{line}</p>
                  ) : null,
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("summary")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5 text-sm">
              {(() => {
                const view = summary ? (
                  <>
                    <Translatable
                      entityType="meeting_summary"
                      entityId={meeting.id}
                      field="main_points_md"
                      text={summary.mainPointsMd}
                      canReview={firm}
                      className="whitespace-pre-wrap"
                    />
                    <p className="text-xs text-muted-foreground">
                      {tr("confirmedBy", {
                        who: summary.confirmedByName ?? "—",
                        date: format.dateTime(summary.confirmedAt, { dateStyle: "medium" }),
                      })}{" "}
                      · {tVis(summary.visibility)}
                    </p>
                    <SummarySources
                      meetingId={meeting.id}
                      // Numbered as the database numbers them: one per line, trailing newlines dropped.
                      lines={summary.mainPointsMd
                        .replace(/\n+$/, "")
                        .split("\n")
                        .map((l) => l.replace(/^\s*[-*•]\s+/, ""))}
                      sources={sources}
                      files={sourceFiles}
                      canEdit={firm && canRun && held}
                      hasTranscript={transcript !== null}
                    />
                  </>
                ) : null;
                if (canRun && held)
                  return (
                    <SummaryBlock
                      view={view}
                      editor={{
                        meetingId: meeting.id,
                        meetingShared: shared,
                        defaultLang: lang,
                        initial: summary
                          ? {
                              mainPointsMd: summary.mainPointsMd,
                              lang: summary.lang as "ar" | "en",
                              visibility: summary.visibility as "shared" | "firm_private",
                            }
                          : null,
                      }}
                    />
                  );
                return (
                  view ?? <p className="text-muted-foreground">{canRun && scheduled ? tr("summaryAfter") : t("noSummary")}</p>
                );
              })()}
            </CardContent>
          </Card>

          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("decisions")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-5 text-sm">
              {decisions.length === 0 ? <p className="text-muted-foreground">{t("noDecisions")}</p> : null}
              <ol className="space-y-3">
                {decisions.map((d, i) => (
                  <li key={d.id} className="flex gap-3">
                    <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
                    <div className={`min-w-0 flex-1 space-y-1 ${replaced.has(d.id) ? "text-muted-foreground line-through" : ""}`}>
                      <Translatable entityType="meeting_decision" entityId={d.id} field="text" text={d.text} canReview={firm} />
                      <p className="text-xs text-muted-foreground no-underline">
                        {[
                          d.decidedBy ? t("decidedBy", { who: d.decidedBy }) : null,
                          d.supersedesId ? tr("replaces", { n: decisionNo.get(d.supersedesId) ?? "?" }) : null,
                          replaced.has(d.id) ? tr("replaced") : null,
                          shared && d.visibility !== "shared" ? tVis(d.visibility) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {canRun && held ? (
                <DecisionForm meetingId={meeting.id} meetingShared={shared} defaultLang={lang} decisions={pickable} />
              ) : null}
            </CardContent>
          </Card>

          {followUps.length || (canFollowUp && meeting.status !== "cancelled") ? (
            <Card className="gap-3 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{tr("followUps")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-5 text-sm">
                {followUps.length === 0 ? <p className="text-muted-foreground">{tr("noFollowUps")}</p> : null}
                <ul className="divide-y">
                  {followUps.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className={f.status === "done" ? "text-muted-foreground line-through" : "font-medium"} dir="auto">
                          {f.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            f.assignee ?? tr("nobody"),
                            f.dueAt ? tr("dueOn", { date: format.dateTime(f.dueAt, { dateStyle: "medium" }) }) : null,
                            f.decisionId && decisionNo.has(f.decisionId)
                              ? tr("forDecisionN", { n: decisionNo.get(f.decisionId)! })
                              : null,
                            shared && f.visibility !== "shared" ? tVis(f.visibility) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {canFollowUp || f.assigneeUserId === me ? <FollowUpToggle id={f.id} status={f.status} /> : null}
                    </li>
                  ))}
                </ul>
                {canFollowUp && meeting.status !== "cancelled" ? (
                  <FollowUpForm
                    meetingId={meeting.id}
                    meetingShared={shared}
                    people={invitees?.people ?? []}
                    decisions={pickable}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {firm && canRun ? (
            <TranscriptPanel
              meetingId={meeting.id}
              consent={meeting.transcriptConsent}
              held={held}
              spokenLang={meeting.spokenLang as "ar" | "en" | "mixed"}
              transcript={
                transcript
                  ? {
                      ...transcript,
                      importedAt: format.dateTime(transcript.importedAt, { dateStyle: "medium" }),
                      deleteAfter: format.dateTime(new Date(transcript.deleteAfter), { dateStyle: "medium" }),
                    }
                  : null
              }
            />
          ) : null}
        </div>

        <Card className="h-fit gap-3 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("attendees")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            <ul className="space-y-2 text-sm">
              {attendees.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {a.name ?? "—"}
                    {a.contactId ? <span className="text-xs text-muted-foreground"> · {t("contact")}</span> : null}
                    {a.role === "optional" ? <span className="text-xs text-muted-foreground"> · {t("optional")}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {a.role === "organizer" ? t("organizer") : t(`response.${a.response}`)}
                    {canRun && a.role !== "organizer" && meeting.status !== "cancelled" ? (
                      <RemoveAttendee meetingId={meeting.id} attendeeId={a.id} name={a.name ?? "—"} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {canRun && meeting.status !== "cancelled" ? <AddAttendee meetingId={meeting.id} options={addOptions} /> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

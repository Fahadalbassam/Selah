import { ArrowLeft, CalendarPlus, Video } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ApiButton } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Translatable } from "@/components/translatable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withPrincipal } from "@/server/page";
import { getMeeting } from "@/services/meetings";
import { TranscriptPanel } from "./transcript-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data, firm, ended } = await withPrincipal(async (tx, principal) => {
    const data = await getMeeting(tx, principal, id);
    return { data, firm: principal.orgKind === "firm", ended: data.meeting.endsAt < new Date() };
  });
  const [t, tVis, format] = await Promise.all([getTranslations("meeting"), getTranslations("visibility"), getFormatter()]);
  const { meeting, attendees, decisions, summary, transcript } = data;
  const when = `${format.dateTime(meeting.startsAt, { dateStyle: "full", timeStyle: "short" })} – ${format.dateTime(meeting.endsAt, { timeStyle: "short" })}`;

  return (
    <>
      <Link
        href={`/projects/${meeting.projectId}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader title={meeting.title}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meeting.status === "cancelled" ? "destructive" : meeting.status === "held" ? "secondary" : "outline"}>
            {t(`status.${meeting.status}`)}
          </Badge>
          <Badge variant="outline">{tVis(meeting.visibility)}</Badge>
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="gap-3 py-5 shadow-xs">
            <CardContent className="flex flex-wrap items-center gap-3 px-5 text-sm">
              <span className="tabular-nums">{when}</span>
              {meeting.joinUrl && meeting.status === "scheduled" ? (
                <Button asChild size="sm">
                  <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">
                    <Video />
                    {t("join")}
                  </a>
                </Button>
              ) : null}
              {meeting.locationText ? <span className="text-muted-foreground">{meeting.locationText}</span> : null}
              <Button asChild size="sm" variant="outline">
                <a href={`/api/meetings/${meeting.id}/ics`}>
                  <CalendarPlus />
                  {t("calendar")}
                </a>
              </Button>
              {data.canRun && meeting.status === "scheduled" && ended ? (
                <ApiButton
                  endpoint={`/api/meetings/${meeting.id}`}
                  method="PATCH"
                  body={{ status: "held" }}
                  label={t("markHeld")}
                />
              ) : null}
            </CardContent>
          </Card>

          {meeting.agendaMd ? (
            <Card className="gap-3 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("agenda")}</CardTitle>
              </CardHeader>
              <CardContent className="px-5 text-sm whitespace-pre-wrap">{meeting.agendaMd}</CardContent>
            </Card>
          ) : null}

          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("summary")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5 text-sm">
              {summary ? (
                <>
                  <Translatable
                    entityType="meeting_summary"
                    entityId={meeting.id}
                    field="main_points_md"
                    text={summary.mainPointsMd}
                    canReview={firm}
                  />
                  <p className="text-xs text-muted-foreground">{tVis(summary.visibility)}</p>
                </>
              ) : (
                <p className="text-muted-foreground">{t("noSummary")}</p>
              )}
            </CardContent>
          </Card>

          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("decisions")}</CardTitle>
            </CardHeader>
            <CardContent className="px-5 text-sm">
              {decisions.length === 0 ? <p className="text-muted-foreground">{t("noDecisions")}</p> : null}
              <ol className="space-y-3">
                {decisions.map((d) => (
                  <li key={d.id} className="space-y-1">
                    <Translatable entityType="meeting_decision" entityId={d.id} field="text" text={d.text} canReview={firm} />
                    {d.decidedBy ? <p className="text-xs text-muted-foreground">{t("decidedBy", { who: d.decidedBy })}</p> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {firm && data.canRun ? (
            <TranscriptPanel
              meetingId={meeting.id}
              consent={meeting.transcriptConsent}
              held={meeting.status === "held"}
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
          <CardContent className="px-5">
            <ul className="space-y-2 text-sm">
              {attendees.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>{a.name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.role === "organizer" ? t("organizer") : t(`response.${a.response}`)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import { getFormatter, getTranslations } from "next-intl/server";
import { ToneBadge } from "@/components/tone-badge";
import { ownerNextStep, type HomeSection as SectionKey } from "@/lib/home";
import { cn } from "@/lib/utils";
import type { HomeActionRow, HomeDocument, HomeFollowUp, HomeMeeting } from "@/services/home";
import { HomeRow, HomeSection } from "./home-section";

/** The date words of a client reader's rows: due, late, or none. */
async function dates() {
  const [t, format] = await Promise.all([getTranslations("home.mine"), getFormatter()]);
  const day = (d: string | Date) =>
    typeof d === "string" ? format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : format.dateTime(d, { dateStyle: "medium" });
  const due = (date: string | Date | null, overdue: boolean) => (
    <span className={cn(overdue && "font-medium text-destructive")}>{date === null ? t("noDate") : t(overdue ? "late" : "due", { date: day(date) })}</span>
  );
  return { t, day, due, format };
}

/** Rows for the reader's own actions, each with the step that waits on its page ("Send for review"). */
export async function actionRows(rows: HomeActionRow[]) {
  const [{ t, day, due }, tSteps] = await Promise.all([dates(), getTranslations("home.steps")]);
  return rows.map((a) => (
    <HomeRow
      key={a.id}
      href={a.href}
      title={a.title}
      sub={a.projectTitle}
      meta={
        <>
          {due(a.dueDate, a.overdue)}
          {a.dateAsked ? <ToneBadge tone="waiting">{t("dateAsked", { date: day(a.dateAsked) })}</ToneBadge> : null}
        </>
      }
      step={tSteps(ownerNextStep(a.status))}
    />
  ));
}

/**
 * What a client person is asked for besides their actions, in the order of
 * page audit 4.2: the files asked of them by name, the meetings waiting for
 * their reply and their next meeting, then their follow-ups.
 */
export async function DocumentsSection({ rows, open }: { rows: HomeDocument[]; open: SectionKey | null }) {
  const [{ t, due }, tSteps] = await Promise.all([dates(), getTranslations("home.steps")]);
  return (
    <HomeSection
      id="documents"
      title={t("documents.title")}
      description={t("documents.description")}
      open={open === "documents"}
      rows={rows.map((r) => (
        <HomeRow key={r.id} href={r.href} title={r.title} sub={r.projectTitle} meta={due(r.dueDate, r.overdue)} step={tSteps("sendFile")} />
      ))}
    />
  );
}

export async function MeetingSections({ replies, next, open }: { replies: HomeMeeting[]; next: HomeMeeting | null; open: SectionKey | null }) {
  const [{ t, format }, tSteps] = await Promise.all([dates(), getTranslations("home.steps")]);
  const when = (d: Date) => format.dateTime(d, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const meta = (m: HomeMeeting) => (
    <>
      {m.today ? <ToneBadge tone="new">{t("today")}</ToneBadge> : null}
      <span>{when(m.startsAt)}</span>
    </>
  );
  return (
    <>
      <HomeSection
        id="replies"
        title={t("replies.title")}
        open={open === "replies"}
        rows={replies.map((m) => (
          <HomeRow key={m.id} href={m.href} title={m.title} sub={m.projectTitle} meta={meta(m)} step={tSteps("reply")} />
        ))}
      />
      {next ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("nextMeeting.title")}</h2>
          <ul className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <HomeRow href={next.href} title={next.title} sub={next.projectTitle} meta={meta(next)} step={tSteps("open")} />
          </ul>
        </section>
      ) : null}
    </>
  );
}

export async function FollowUpsSection({ rows, open }: { rows: HomeFollowUp[]; open: SectionKey | null }) {
  const [{ t, due }, tSteps] = await Promise.all([dates(), getTranslations("home.steps")]);
  return (
    <HomeSection
      id="followUps"
      title={t("followUps.title")}
      description={t("followUps.description")}
      open={open === "followUps"}
      rows={rows.map((r) => (
        <HomeRow key={r.id} href={r.href} title={r.title} sub={r.projectTitle} meta={due(r.dueAt, r.overdue)} step={tSteps("open")} />
      ))}
    />
  );
}

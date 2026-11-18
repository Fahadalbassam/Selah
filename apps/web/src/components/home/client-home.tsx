import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ClientProgress } from "@/components/client-progress";
import { DeliverableList } from "@/components/deliverables/deliverable-list";
import { GroupProgress } from "@/components/group-progress";
import { IndicatorsCard, indicatorName } from "@/components/indicators/indicators-card";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge } from "@/components/tone-badge";
import { Card, CardContent } from "@/components/ui/card";
import { shown, showAllHref, HOME_ROWS, type HomeSection as SectionKey } from "@/lib/home";
import { localLabel } from "@/lib/names";
import { DATE_ANSWER_DAYS, type ClientHome } from "@/services/home";
import { HomeRow, HomeSection } from "./home-section";
import { actionRows, DocumentsSection, FollowUpsSection, MeetingSections } from "./my-work";

/**
 * The client admin's and client manager's home (page audit 4.2): what waits
 * for them first, then the company's progress table, its business
 * indicators and the report button, and the group's roll-up for the people
 * the firm named.
 */
export async function ClientHomeLists({ data, open }: { data: ClientHome; open: SectionKey | null }) {
  const [t, tSteps, tHome, tDl, tGroups, format, locale] = await Promise.all([
    getTranslations("home.client"),
    getTranslations("home.steps"),
    getTranslations("home"),
    getTranslations("deliverables"),
    getTranslations("clientGroups"),
    getFormatter(),
    getLocale(),
  ]);
  const ar = locale === "ar";
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  const choices = [
    ...(data.assistantOffer ? [{ key: "assistant", title: t("choices.assistant"), href: "/assistant", step: tSteps("readAndDecide") }] : []),
    ...(data.dataSetup
      ? [{ key: "data", title: t("choices.dataSharing"), href: `/indicators/data?client=${data.dataSetup.clientId}`, step: tSteps("choose") }]
      : []),
  ];
  const waiting =
    data.answers.length +
    data.documents.length +
    data.sentBack.length +
    data.lateOrStopped.length +
    data.dates.length +
    data.replies.length +
    (data.nextMeeting ? 1 : 0) +
    data.followUps.length +
    data.indicatorsDue.length +
    data.deliverables.length +
    choices.length;
  // The indicators card where there is something to read, or a company still at work that could add its figures (page audit 8).
  const running = data.overview?.projects.some((p) => p.state === "planned" || p.state === "active") ?? false;
  const indicators = data.indicators && (data.indicators.indicators.length || (data.indicators.canManage && running)) ? data.indicators : null;
  const deliverablesOpen = open === "deliverables";

  return (
    <>
      <HomeSection
        id="answers"
        title={t("answers.title")}
        description={t("answers.description")}
        open={open === "answers"}
        rows={data.answers.map((r) => <HomeRow key={r.id} href={r.href} title={r.title} sub={r.projectTitle} step={tSteps("answer")} />)}
      />
      <DocumentsSection rows={data.documents} open={open} />
      <HomeSection id="sentBack" title={t("sentBack.title")} description={t("sentBack.description")} open={open === "sentBack"} rows={await actionRows(data.sentBack)} />
      <HomeSection id="late" title={t("late.title")} open={open === "late"} rows={await actionRows(data.lateOrStopped)} />
      <HomeSection
        id="dates"
        title={t("dates.title")}
        description={t("dates.description", { days: DATE_ANSWER_DAYS })}
        open={open === "dates"}
        rows={data.dates.map((r) => (
          <HomeRow
            key={r.id}
            href={r.href}
            title={r.title}
            sub={r.projectTitle}
            meta={<ToneBadge tone={r.approved ? "active" : "neutral"}>{t(r.approved ? "dates.agreed" : "dates.notAgreed", { date: day(r.proposed) })}</ToneBadge>}
            step={tSteps("open")}
          />
        ))}
      />
      <MeetingSections replies={data.replies} next={data.nextMeeting} open={open} />
      <FollowUpsSection rows={data.followUps} open={open} />
      <HomeSection
        id="indicators"
        title={t("indicators.title")}
        open={open === "indicators"}
        rows={data.indicatorsDue.map((k) => (
          <HomeRow
            key={k.id}
            href={k.href}
            title={indicatorName(k, ar)}
            meta={<ToneBadge tone="waiting">{t(`indicators.${k.status}`)}</ToneBadge>}
            step={tSteps("enterValue")}
          />
        ))}
      />
      {data.deliverables.length ? (
        <section id="deliverables" className="scroll-mt-16 space-y-3">
          <SectionHeader title={tDl("cardTitle")} description={tDl("cardHint")} />
          <Card className="gap-4 py-5 shadow-xs">
            <CardContent className="space-y-3 px-5">
              <DeliverableList deliverables={shown(data.deliverables, deliverablesOpen)} firmRun={false} showProject />
              {!deliverablesOpen && data.deliverables.length > HOME_ROWS ? (
                <Link href={showAllHref("deliverables")} className="block text-sm text-muted-foreground hover:text-foreground hover:underline">
                  {tHome("showAll", { n: data.deliverables.length })}
                </Link>
              ) : null}
              <Link href="/deliverables" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                {tDl("seeAll")}
              </Link>
            </CardContent>
          </Card>
        </section>
      ) : null}
      {/* The client admin's two standing questions, until answered: one row each, not a card above everything (page audit row 29). */}
      {choices.length ? (
        <section id="choices" className="space-y-3">
          <h2 className="text-base font-semibold">{t("choices.title")}</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {choices.map((c) => (
              <HomeRow key={c.key} href={c.href} title={c.title} step={c.step} />
            ))}
          </ul>
        </section>
      ) : null}

      {waiting === 0 ? <p className="text-sm text-muted-foreground">{tHome("nothingWaits")}</p> : null}

      {data.overview && data.overview.projects.length ? <ClientProgress data={data.overview} tiles={false} /> : null}
      {indicators ? <IndicatorsCard data={indicators} quiet /> : null}
      {data.group ? (
        <section id="group" className="scroll-mt-16 space-y-3">
          <SectionHeader title={localLabel(data.group.group, ar)} description={tGroups("clientHint")} />
          <GroupProgress total={data.group.total} companies={data.group.companies} links={false} />
        </section>
      ) : null}
    </>
  );
}


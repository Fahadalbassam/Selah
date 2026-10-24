import { getFormatter, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CASE_STUDY_LEVELS, CASE_STUDY_LIMITS, type CaseStudyLevel } from "@/lib/case-study";
import type { CaseStudyView } from "@/services/case-study";

const LEVEL_TONE: Record<CaseStudyLevel, Tone> = { none: "neutral", metrics_only: "open", anonymised: "open", named: "active" };

/**
 * Case-study consent (F37) on the Closing tab: whether the firm may cite the
 * project and how, who gave it and when, and every earlier record. The
 * client's sponsor or admin gives and withdraws it; the firm admin records
 * one the client gave outside Selah.
 */
export async function CaseStudySection({ projectId, data }: { projectId: string; data: CaseStudyView }) {
  const t = await getTranslations("closure.caseStudy");
  const format = await getFormatter();
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const endpoint = `/api/projects/${projectId}/closure/case-study`;
  const current = data.current;
  const levelOptions = CASE_STUDY_LEVELS.map((l) => ({ value: l, label: `${t(`levels.${l}`)}: ${t(`levelHints.${l}`)}` }));
  const yesNo = [
    { value: "no", label: t("no") },
    { value: "yes", label: t("yes") },
  ];
  const fields = [
    { name: "level", label: t("level"), type: "select" as const, required: true, defaultValue: current?.level ?? "", placeholder: t("chooseLevel"), options: levelOptions },
    { name: "testimonial", label: t("testimonial"), type: "select" as const, required: true, defaultValue: current?.testimonial ? "yes" : "no", options: yesNo },
    { name: "conditions", label: t("conditionsField"), type: "textarea" as const, maxLength: CASE_STUDY_LIMITS.conditions, defaultValue: current?.conditions ?? undefined },
  ];
  const earlier = data.history.slice(1);

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          {data.can.give ? (
            <FormDialog
              trigger={
                <Button size="sm" variant={current ? "outline" : "default"}>
                  {current ? t("change") : t("give")}
                </Button>
              }
              title={t("giveTitle")}
              description={t("giveHint")}
              endpoint={endpoint}
              method="PUT"
              fields={fields}
              submitLabel={t("save")}
            />
          ) : null}
          {data.can.record ? (
            <FormDialog
              trigger={
                <Button size="sm" variant="outline">
                  {t("record")}
                </Button>
              }
              title={t("recordTitle")}
              description={t("recordHint")}
              endpoint={endpoint}
              method="PUT"
              fields={[
                ...fields,
                {
                  name: "sourceNote",
                  label: t("source"),
                  type: "textarea" as const,
                  required: true,
                  maxLength: CASE_STUDY_LIMITS.source.max,
                  placeholder: t("sourcePlaceholder"),
                },
              ]}
              submitLabel={t("save")}
            />
          ) : null}
          {data.can.revoke ? <ApiButton endpoint={endpoint} method="DELETE" label={t("revoke")} variant="ghost" confirm={t("revokeConfirm")} /> : null}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {current ? (
          <Record r={current} t={t} day={day} />
        ) : (
          <div className="space-y-1 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={data.latest ? "neutral" : "waiting"}>{data.latest ? t("levels.none") : t("notAsked")}</ToneBadge>
              <span className="text-muted-foreground">{t("defaultNone")}</span>
            </p>
            {data.latest?.revokedAt ? (
              <p className="text-xs text-muted-foreground">{t("revokedBy", { date: day(data.latest.revokedAt), who: data.latest.revokedBy ?? t("someone") })}</p>
            ) : null}
          </div>
        )}
        {earlier.length || (!current && data.latest) ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("history")}</p>
            <ul className="divide-y rounded-lg border text-sm">
              {(current ? earlier : data.history).map((r) => (
                <li key={r.id} className="px-3 py-2">
                  <Record r={r} t={t} day={day} compact />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Row = CaseStudyView["history"][number];

/** One consent record: the level, the testimonial, the conditions, who gave it and when, and its withdrawal. */
function Record({
  r,
  t,
  day,
  compact = false,
}: {
  r: Row;
  t: Awaited<ReturnType<typeof getTranslations>>;
  day: (d: Date | string) => string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={LEVEL_TONE[r.level]}>{t(`levels.${r.level}`)}</ToneBadge>
        <span className="text-sm">{r.testimonial ? t("testimonialYes") : t("testimonialNo")}</span>
        {r.revokedAt ? <ToneBadge tone="problem">{t("withdrawn")}</ToneBadge> : null}
      </p>
      {!compact ? <p className="text-xs text-muted-foreground">{t(`levelHints.${r.level}`)}</p> : null}
      {r.conditions ? (
        <p className="text-sm whitespace-pre-wrap" dir="auto">
          <span className="text-xs text-muted-foreground">{t("conditions")}: </span>
          {r.conditions}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {r.recordedByFirm
          ? t("recordedBy", { date: day(r.givenAt), who: r.givenBy ?? t("someone") })
          : t("givenBy", { date: day(r.givenAt), who: r.givenBy ?? t("someone") })}
        {r.revokedAt ? ` · ${t("revokedBy", { date: day(r.revokedAt), who: r.revokedBy ?? t("someone") })}` : ""}
      </p>
      {r.sourceNote ? (
        <p className="text-xs whitespace-pre-wrap text-muted-foreground" dir="auto">
          {t("sourceShown", { note: r.sourceNote })}
        </p>
      ) : null}
    </div>
  );
}

import { MessageSquare } from "@/components/animate-ui/icons/message-square";
import { Lock } from "@/components/animate-ui/icons/lock";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { SectionHeader } from "@/components/section-header";
import { StatTile } from "@/components/stat-tile";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PULSE_LIMITS, PULSE_LOW, PULSE_QUESTIONS, PULSE_SCALE, type PulseQuestion } from "@/lib/pulse";
import type { PulseView } from "@/services/pulse";

/**
 * The closing pulse (F36) on the Closing tab. A client person who was asked
 * answers it here (or changes the answer while it is open); the firm admin
 * and the client's lead see every answer, the averages and who answered.
 */
export async function PulseSection({ projectId, data }: { projectId: string; data: PulseView }) {
  const t = await getTranslations("closure.pulse");
  const format = await getFormatter();
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const open = data.open;

  return (
    <div className="space-y-6">
      {data.can.answer || data.mine ? <ClientCard projectId={projectId} data={data} /> : null}
      {data.results ? (
        <section className="space-y-3">
          <SectionHeader
            title={t("results")}
            description={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <Lock className="size-3" />
                  {t("firmOnly")}
                </Badge>
                {t("resultsHint")}
              </span>
            }
          >
            {data.openUntil ? (
              <span className="text-xs text-muted-foreground">
                {open ? t("openUntil", { date: day(data.openUntil) }) : t("lockedOn", { date: day(data.openUntil) })}
              </span>
            ) : null}
          </SectionHeader>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label={t("answered")} value={t("answeredValue", { n: data.results.answers.length, of: data.results.invited })} />
            {PULSE_QUESTIONS.map((q) => (
              <StatTile
                key={q}
                label={t(`short.${q}`)}
                value={data.results!.averages[q] === null ? "—" : format.number(data.results!.averages[q]!, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                hint={t("outOf5")}
              />
            ))}
          </div>
          {data.results.answers.length === 0 ? (
            <EmptyState icon={<MessageSquare animateOnView />} description={t("noAnswers")} className="py-6 md:py-6" />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("person")}</TableHead>
                    {PULSE_QUESTIONS.map((q) => (
                      <TableHead key={q} className="text-center">
                        {t(`short.${q}`)}
                      </TableHead>
                    ))}
                    <TableHead>{t("comment")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.results.answers.map((a) => (
                    <TableRow key={a.userId}>
                      <TableCell className="align-top">
                        <p className="font-medium" dir="auto">
                          {a.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{day(a.updatedAt)}</p>
                      </TableCell>
                      {PULSE_QUESTIONS.map((q) => (
                        <TableCell key={q} className="text-center align-top tabular-nums">
                          {a[q] <= PULSE_LOW ? <ToneBadge tone="problem">{a[q]}</ToneBadge> : a[q]}
                        </TableCell>
                      ))}
                      <TableCell className="max-w-96 align-top whitespace-pre-wrap" dir="auto">
                        {a.comment ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** What the client person asked sees: the three questions, and their own answer. */
async function ClientCard({ projectId, data }: { projectId: string; data: PulseView }) {
  const t = await getTranslations("closure.pulse");
  const format = await getFormatter();
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const mine = data.mine;
  const scale = [...PULSE_SCALE].reverse().map((n) => ({ value: String(n), label: t(`scale.${n}`) }));
  const field = (q: PulseQuestion) => ({
    name: q,
    label: t(`questions.${q}`),
    type: "select" as const,
    required: true,
    defaultValue: mine ? String(mine[q]) : "",
    placeholder: t("choose"),
    options: scale,
  });

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("clientHint")}</CardDescription>
        {data.can.answer ? (
          <CardAction>
            <FormDialog
              trigger={
                <Button size="sm" variant={mine ? "outline" : "default"}>
                  {mine ? t("change") : t("answer")}
                </Button>
              }
              title={t("title")}
              description={t("clientHint")}
              endpoint={`/api/projects/${projectId}/closure/pulse`}
              method="PUT"
              fields={[
                ...PULSE_QUESTIONS.map(field),
                { name: "comment", label: t("commentLabel"), type: "textarea", maxLength: PULSE_LIMITS.comment, defaultValue: mine?.comment ?? undefined },
              ]}
              submitLabel={mine ? t("save") : t("send")}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        {mine ? (
          <dl className="grid gap-3 text-sm md:grid-cols-3">
            {PULSE_QUESTIONS.map((q) => (
              <div key={q} className="space-y-1 rounded-lg border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{t(`questions.${q}`)}</dt>
                <dd className="font-medium tabular-nums">{t(`scale.${mine[q]}`)}</dd>
              </div>
            ))}
            {mine.comment ? (
              <div className="space-y-1 md:col-span-3">
                <dt className="text-xs text-muted-foreground">{t("yourComment")}</dt>
                <dd className="whitespace-pre-wrap" dir="auto">
                  {mine.comment}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {data.can.answer && data.openUntil
            ? mine
              ? t("changeUntil", { date: day(data.openUntil) })
              : t("openUntil", { date: day(data.openUntil) })
            : t("locked")}
        </p>
      </CardContent>
    </Card>
  );
}

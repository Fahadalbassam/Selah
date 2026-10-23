import { ArrowLeft, ScrollText } from "lucide-react";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Lock } from "@/components/animate-ui/icons/lock";
import { X } from "@/components/animate-ui/icons/x";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChoiceOption, QuestionType } from "@/lib/assessments";
import { isUuid } from "@/lib/ids";
import { withPrincipal } from "@/server/page";
import { assessmentFollowUp, getAssessment, listAssessments } from "@/services/assessments";
import { getProject } from "@/services/queries";
import { AddEvidence, AnswerControl, AssessmentButton, ComparePicker, ConfirmGap, NoteEditor } from "./assessment-panels";

/** A section's number as its questions' refs give it ("0.1" → 0), so the two agree; else its position. */
function sectionNumber(questions: { ref: string | null }[], index: number) {
  const head = questions.find((q) => q.ref)?.ref?.split(".")[0];
  return head && /^\d+$/.test(head) ? head : String(index + 1);
}

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => {
    const a = await getAssessment(tx, principal, id);
    const project = await getProject(tx, principal, a.projectId);
    const all = await listAssessments(tx, principal, a.projectId);
    const firm = principal.orgKind === "firm";
    return {
      a,
      project: project.project,
      // Evidence is a project file the firm can see, never a client-private one.
      files: project.documents.filter((d) => d.visibility !== "client_private").map((d) => ({ id: d.id, title: d.title, createdAt: d.createdAt })),
      templateId: all.find((x) => x.id === id)?.templateId,
      others: all.filter((x) => x.id !== id),
      followUp: firm && a.status === "final" ? await assessmentFollowUp(tx, principal, id) : [],
      firm,
    };
  });
  const [t, tq, format] = await Promise.all([
    getTranslations("assessment.run"),
    getTranslations("assessment.question"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { a, project, firm, followUp } = data;
  // Files often share a name (draft.pdf sent three times): add the date so they can be told apart.
  const dupes = new Set(data.files.map((f) => f.title).filter((title, i, all) => all.indexOf(title) !== i));
  const files = data.files.map((f) => ({
    id: f.id,
    title: dupes.has(f.title) ? `${f.title} · ${format.dateTime(f.createdAt, { dateStyle: "medium", timeStyle: "short" })}` : f.title,
  }));
  const draft = a.status === "draft";
  const conduct = a.canConduct;
  const edit = draft && conduct;
  const pct = (n: number | null) => (n === null ? "—" : `${format.number(n, { maximumFractionDigits: 1 })}%`);
  const others = data.others
    .filter((x) => x.templateId === data.templateId)
    .map((x) => ({ id: x.id, label: `${x.title} · ${format.dateTime(x.createdAt, { dateStyle: "medium" })}` }));
  const findingOf = new Map(followUp.map((g) => [g.answerId, g]));
  const questions = a.sections.flatMap((s) => s.questions);

  return (
    <>
      <Link
        href={`/projects/${a.projectId}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {project.title}
      </Link>
      <PageHeader
        title={a.title}
        meta={
          <>
            <Badge variant={draft ? "outline" : "secondary"}>{t(`status.${a.status}`)}</Badge>
            <Badge variant="outline">
              {t("legalForm")}: {tq(`forms.${a.legalForm}`)}
            </Badge>
            {firm ? <Badge variant="outline">{a.sharedWithClient ? t("sharedWithClient") : t("firmOnly")}</Badge> : null}
          </>
        }
      />

      {conduct ? (
        <div className="flex flex-wrap items-center gap-2">
          {draft ? <AssessmentButton kind="finalise" assessmentId={a.id} /> : null}
          {!draft ? <AssessmentButton kind={a.sharedWithClient ? "unshare" : "share"} assessmentId={a.id} /> : null}
          {!draft ? <AssessmentButton kind="retake" assessmentId={a.id} /> : null}
          {!draft ? (
            <FormDialog
              trigger={
                <Button size="sm" variant="outline">
                  <ScrollText />
                  {t("report")}
                </Button>
              }
              title={t("report")}
              description={t("reportHint")}
              endpoint={`/api/assessments/${a.id}/report`}
              fields={[
                { name: "title", label: t("title"), required: true, defaultValue: a.title },
                { name: "periodStart", label: t("periodStart"), type: "date", required: true },
                { name: "periodEnd", label: t("periodEnd"), type: "date", required: true },
                {
                  name: "lang",
                  label: t("reportLang"),
                  type: "select",
                  defaultValue: ar ? "ar" : "en",
                  options: [
                    { value: "ar", label: "العربية" },
                    { value: "en", label: "English" },
                  ],
                },
              ]}
              submitLabel={t("makeReport")}
            />
          ) : null}
          <span className="ms-auto">
            <ComparePicker assessmentId={a.id} others={others} />
          </span>
        </div>
      ) : others.length ? (
        <ComparePicker assessmentId={a.id} others={others} />
      ) : null}

      {firm ? (
        <Card className="gap-3 py-5 shadow-xs">
          <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-3 px-5">
            <div>
              <p className="text-xs text-muted-foreground">{t("points")}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {a.total.earned}/{a.total.possible}{" "}
                <span className="text-base font-normal text-muted-foreground">· {pct(a.total.pct)}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("toAnswer")}</p>
              <p className="text-2xl font-semibold tabular-nums">{a.total.toAnswer}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("gaps")}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {a.total.gaps}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({t("confirmedCount", { n: a.total.confirmed ?? 0 })})
                </span>
              </p>
            </div>
            <p className="flex basis-full items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3" />
              {t("indicative")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">{t("clientView")}</p>
      )}

      {a.sections.map((s, si) => (
        <Card key={s.id} className="gap-4 py-5 shadow-xs">
          <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
            <div className="space-y-1.5">
              <CardTitle className="text-base">
                {sectionNumber(s.questions, si)}. {(ar ? s.titleAr : null) ?? s.title}
              </CardTitle>
              {s.description ? <CardDescription>{(ar ? s.descriptionAr : null) ?? s.description}</CardDescription> : null}
            </div>
            {firm ? (
              <div className="text-end text-sm tabular-nums">
                <p className="font-medium">
                  {s.earned}/{s.possible} · {pct(s.pct)}
                </p>
                <p className="text-xs text-muted-foreground">{t("sectionGaps", { gaps: s.gaps ?? 0, open: s.toAnswer })}</p>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="divide-y px-5">
            {s.questions.map((q) => {
              const cond = q.appliesIfQuestionId ? questions.find((x) => x.id === q.appliesIfQuestionId) : null;
              const legal = q.basis === "legal_requirement";
              const followed = findingOf.get(q.answer.id);
              return (
                <div key={q.id} className={`space-y-3 py-4 ${q.applicable ? "" : "opacity-60"}`}>
                  <div className="flex items-start gap-3">
                    <span className="w-10 shrink-0 text-sm font-medium text-muted-foreground tabular-nums">{q.ref ?? "—"}</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm font-medium">{(ar ? q.promptAr : null) ?? q.prompt}</p>
                      {q.guidance ? (
                        <p className="text-xs text-muted-foreground">{(ar ? q.guidanceAr : null) ?? q.guidance}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* The basis worked out for this client: a gap is never called "non-compliant". */}
                        <Badge variant={legal ? "default" : "secondary"}>{ar ? q.basisLabel.ar : q.basisLabel.en}</Badge>
                        {q.citation ? (
                          <span className="text-xs text-muted-foreground">
                            {q.citation}
                            {q.locator ? ` · ${q.locator}` : ""}
                          </span>
                        ) : null}
                        {q.citation && !q.citationVerified ? <Badge variant="outline">{tq("toVerify")}</Badge> : null}
                      </div>
                      {!q.applicable && cond ? (
                        <p className="text-xs text-muted-foreground">{t("notApplicable", { ref: cond.ref ?? "" })}</p>
                      ) : null}
                    </div>
                    {firm && q.maxPoints !== null && q.applicable ? (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {q.points ?? "—"}/{q.maxPoints}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2 ps-13">
                    {q.applicable ? (
                      <AnswerControl
                        answerId={q.answer.id}
                        type={q.type as QuestionType}
                        value={q.answer.value}
                        textAnswer={q.answer.textAnswer}
                        options={q.options as ChoiceOption[] | null}
                        readOnly={!edit}
                      />
                    ) : null}
                    {firm && q.isGap ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
                        {q.findingId ? (
                          <>
                            <Badge>{t("gapConfirmed")}</Badge>
                            {followed ? (
                              <span className="text-xs text-muted-foreground">
                                {t("gapWork", {
                                  recs: followed.recommendations,
                                  actions: followed.actions,
                                  verified: followed.verified,
                                })}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <Badge variant="outline">{t("gapSuggested")}</Badge>
                            <span className="text-xs text-muted-foreground">{draft ? t("gapAfterFinal") : t("gapHint")}</span>
                            {!draft && conduct ? (
                              <ConfirmGap answerId={q.answer.id} prompt={(ar ? q.promptAr : null) ?? q.prompt} />
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {edit ? (
                        <NoteEditor answerId={q.answer.id} kind="comment" text={q.answer.comment} />
                      ) : q.answer.comment ? (
                        <p className="text-xs">
                          <span className="font-medium">{t("comment")}:</span> {q.answer.comment}
                        </p>
                      ) : null}
                      {firm && conduct ? (
                        <NoteEditor
                          answerId={q.answer.id}
                          kind="note"
                          text={"firmNote" in q.answer ? (q.answer.firmNote ?? null) : null}
                        />
                      ) : null}
                    </div>
                    {q.evidence.length ? (
                      <ul className="flex flex-wrap gap-2">
                        {q.evidence.map((e) => (
                          <li key={e.documentId} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                            <FileText className="size-3 text-muted-foreground" />
                            <a href={`/api/documents/${e.documentId}/download`} className="hover:underline">
                              {e.title}
                            </a>
                            {edit ? (
                              <ApiButton
                                endpoint={`/api/assessment-answers/${q.answer.id}/evidence/${e.documentId}`}
                                method="DELETE"
                                label=""
                                icon={<X />}
                                variant="ghost"
                                title={t("removeFile")}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {edit ? (
                      <AddEvidence
                        answerId={q.answer.id}
                        files={files.filter((f) => !q.evidence.some((e) => e.documentId === f.id))}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {firm && !draft ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("followUp")}</CardTitle>
            <CardDescription>{t("followUpHint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            {followUp.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noFollowUp")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("finding")}</TableHead>
                    <TableHead className="text-end">{t("recs")}</TableHead>
                    <TableHead className="text-end">{t("actions")}</TableHead>
                    <TableHead className="text-end">{t("reported")}</TableHead>
                    <TableHead className="text-end">{t("evidenced")}</TableHead>
                    <TableHead className="text-end">{t("verified")}</TableHead>
                    <TableHead className="text-end">{t("overdue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {followUp.map((g) => (
                    <TableRow key={g.findingId}>
                      <TableCell>
                        {g.ref ? <span className="me-2 text-muted-foreground tabular-nums">{g.ref}</span> : null}
                        {g.findingTitle}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{g.recommendations}</TableCell>
                      <TableCell className="text-end tabular-nums">{g.actions}</TableCell>
                      <TableCell className="text-end tabular-nums">{g.reported}</TableCell>
                      <TableCell className="text-end tabular-nums">{g.evidenced}</TableCell>
                      <TableCell className="text-end tabular-nums">{g.verified}</TableCell>
                      <TableCell className="text-end tabular-nums">{g.overdue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

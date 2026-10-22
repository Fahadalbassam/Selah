import { Archive, ArchiveRestore, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Copy } from "@/components/animate-ui/icons/copy";
import { Plus } from "@/components/animate-ui/icons/plus";
import { Send } from "@/components/animate-ui/icons/send";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { answerValues, BASIS_LABELS, type ChoiceOption, type OwnBasis, type QuestionType } from "@/lib/assessments";
import { withPrincipal } from "@/server/page";
import { getTemplateVersion, templateOverview } from "@/services/assessments";
import { QuestionDialog, type EditableQuestion } from "./question-dialog";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  if (!UUID.test(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    const template = await templateOverview(tx, principal, id);
    // The open draft by default, else the latest published version.
    const pick =
      template.versions.find((x) => x.id === v) ??
      template.versions.find((x) => x.status === "draft") ??
      template.versions.find((x) => x.status === "published");
    return { template, version: pick ? await getTemplateVersion(tx, principal, pick.id) : null };
  });
  if (!data) notFound();
  const [t, tq, format] = await Promise.all([
    getTranslations("assessment.templates"),
    getTranslations("assessment.question"),
    getFormatter(),
  ]);
  const tv = await getTranslations("assessment.values");
  const locale = await getLocale();
  const ar = locale === "ar";
  const { template, version } = data;
  const draft = version?.status === "draft";
  const edit = draft && template.canAuthor;
  const hasDraft = template.versions.some((x) => x.status === "draft");
  const hasPublished = template.versions.some((x) => x.status === "published");
  const questions = version?.sections.flatMap((s) => s.questions) ?? [];
  const label = (x: { title?: string; titleAr?: string | null }) => (ar ? x.titleAr : null) ?? x.title;
  const prompt = (q: { prompt: string; promptAr: string | null }) => (ar ? q.promptAr : null) ?? q.prompt;
  // Earlier scored questions a new or edited question can depend on.
  const conditionTargets = questions
    .filter((q) => q.type !== "text")
    .map((q) => ({
      id: q.id,
      label: `${q.ref ? `${q.ref} ` : ""}${prompt(q)}`,
      values: answerValues({ type: q.type as QuestionType, options: q.options as ChoiceOption[] | null }),
      options: q.options as ChoiceOption[] | null,
    }));

  return (
    <>
      <Link href="/templates" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("title")}
      </Link>
      <PageHeader
        title={(ar ? template.nameAr : null) ?? template.name}
        description={((ar ? template.descriptionAr : null) ?? template.description) || undefined}
        meta={template.archivedAt ? <Badge variant="secondary">{t("archived")}</Badge> : null}
      >
        {template.canAuthor ? (
            <>
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    <Pencil />
                    {t("rename")}
                  </Button>
                }
                title={t("rename")}
                endpoint={`/api/assessment-templates/${template.id}`}
                method="PATCH"
                sendEmptyAsNull
                fields={[
                  { name: "name", label: t("name"), required: true, dir: "ltr", defaultValue: template.name },
                  { name: "nameAr", label: t("nameAr"), dir: "rtl", defaultValue: template.nameAr ?? "" },
                  { name: "description", label: t("description"), type: "textarea", defaultValue: template.description ?? "" },
                  {
                    name: "descriptionAr",
                    label: t("descriptionAr"),
                    type: "textarea",
                    dir: "rtl",
                    defaultValue: template.descriptionAr ?? "",
                  },
                ]}
                submitLabel={t("save")}
              />
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    <Copy />
                    {t("duplicate")}
                  </Button>
                }
                title={t("duplicate")}
                description={t("duplicateHint")}
                endpoint={`/api/assessment-templates/${template.id}/duplicate`}
                fields={[
                  { name: "name", label: t("name"), required: true, dir: "ltr", defaultValue: `${template.name} (2)` },
                  { name: "nameAr", label: t("nameAr"), dir: "rtl" },
                ]}
                submitLabel={t("duplicate")}
                redirectTo="/templates/:id"
              />
              <ApiButton
                endpoint={`/api/assessment-templates/${template.id}`}
                method="PATCH"
                body={{ archived: !template.archivedAt }}
                label={template.archivedAt ? t("restore") : t("archive")}
                icon={template.archivedAt ? <ArchiveRestore /> : <Archive />}
                confirm={template.archivedAt ? undefined : t("archiveConfirm")}
              />
            </>
          ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("versions")}</span>
        {template.versions.map((x) => (
          <Link key={x.id} href={`/templates/${template.id}?v=${x.id}`}>
            <Badge variant={x.id === version?.id ? "default" : "outline"}>
              {x.status === "draft"
                ? t("draft")
                : t("versionOn", {
                    version: x.version,
                    date: x.publishedAt ? format.dateTime(x.publishedAt, { dateStyle: "medium" }) : "—",
                  })}
            </Badge>
          </Link>
        ))}
        {template.canAuthor && !hasDraft && hasPublished ? (
          <ApiButton
            endpoint={`/api/assessment-templates/${template.id}/draft`}
            label={t("newDraft")}
            icon={<Pencil />}
            title={t("newDraftHint")}
          />
        ) : null}
      </div>

      {version ? (
        <>
          <p className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
            {draft ? (template.canAuthor ? t("draftBanner") : t("draftBannerReader")) : t("publishedBanner")}
          </p>
          {edit ? (
            <div className="flex flex-wrap gap-2">
              <FormDialog
                trigger={
                  <Button size="sm" variant="outline">
                    <Plus />
                    {t("addSection")}
                  </Button>
                }
                title={t("addSection")}
                endpoint={`/api/template-versions/${version.id}/sections`}
                extra={{ position: (version.sections.at(-1)?.position ?? 0) + 1 }}
                fields={[
                  { name: "title", label: t("sectionTitle"), required: true, dir: "ltr" },
                  { name: "titleAr", label: t("sectionTitleAr"), dir: "rtl" },
                  { name: "description", label: t("description"), type: "textarea" },
                ]}
                submitLabel={t("add")}
              />
              <ApiButton
                endpoint={`/api/template-versions/${version.id}/publish`}
                label={t("publish")}
                icon={<Send />}
                variant="default"
                confirm={t("publishConfirm")}
              />
              {hasPublished ? (
                <ApiButton
                  endpoint={`/api/template-versions/${version.id}`}
                  method="DELETE"
                  label={t("discardDraft")}
                  icon={<Trash2 />}
                  variant="ghost"
                  confirm={t("discardConfirm")}
                />
              ) : null}
            </div>
          ) : null}

          {version.sections.length === 0 ? <p className="text-sm text-muted-foreground">{t("noSections")}</p> : null}
          {version.sections.map((s, si) => (
            <Card key={s.id} className="gap-4 py-5 shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">
                    {si + 1}. {label(s)}
                  </CardTitle>
                  {s.description ? <CardDescription>{(ar ? s.descriptionAr : null) ?? s.description}</CardDescription> : null}
                </div>
                {edit ? (
                  <div className="flex flex-wrap gap-1">
                    <QuestionDialog
                      versionId={version.id}
                      sectionId={s.id}
                      position={(s.questions.at(-1)?.position ?? 0) + 1}
                      targets={conditionTargets}
                    />
                    <FormDialog
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Pencil />
                          {t("editSection")}
                        </Button>
                      }
                      title={t("editSection")}
                      endpoint={`/api/template-sections/${s.id}`}
                      method="PATCH"
                      sendEmptyAsNull
                      fields={[
                        { name: "title", label: t("sectionTitle"), required: true, dir: "ltr", defaultValue: s.title },
                        { name: "titleAr", label: t("sectionTitleAr"), dir: "rtl", defaultValue: s.titleAr ?? "" },
                        { name: "description", label: t("description"), type: "textarea", defaultValue: s.description ?? "" },
                      ]}
                      submitLabel={t("save")}
                    />
                    <ApiButton
                      endpoint={`/api/template-sections/${s.id}`}
                      method="DELETE"
                      label={t("delete")}
                      variant="ghost"
                      confirm={t("deleteSectionConfirm")}
                    />
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="divide-y px-5">
                {s.questions.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t("noQuestions")}</p> : null}
                {s.questions.map((q) => {
                  const own = BASIS_LABELS[q.basis as OwnBasis];
                  const cond = q.appliesIfQuestionId ? questions.find((x) => x.id === q.appliesIfQuestionId) : null;
                  return (
                    <div key={q.id} className="space-y-2 py-4">
                      <div className="flex items-start gap-3">
                        <span className="w-10 shrink-0 text-sm font-medium text-muted-foreground tabular-nums">
                          {q.ref ?? "—"}
                        </span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <p className="text-sm font-medium">{prompt(q)}</p>
                          {q.guidance ? (
                            <p className="text-xs text-muted-foreground">{(ar ? q.guidanceAr : null) ?? q.guidance}</p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">{tq(`types.${q.type}`)}</Badge>
                            {q.type !== "text" ? <Badge variant="outline">{tq("weightOf", { weight: q.weight })}</Badge> : null}
                            <Badge variant="secondary">{ar ? own.ar : own.en}</Badge>
                            {(q.legalFor ?? []).length ? (
                              <Badge variant="default">
                                {tq("legalFor", { forms: (q.legalFor ?? []).map((f) => tq(`forms.${f}`)).join("، ") })}
                              </Badge>
                            ) : null}
                            {(q.guidanceFor ?? []).length ? (
                              <Badge variant="outline">
                                {tq("guidanceFor", { forms: (q.guidanceFor ?? []).map((f) => tq(`forms.${f}`)).join("، ") })}
                              </Badge>
                            ) : null}
                            {q.citation && !q.citationVerified ? <Badge variant="outline">{tq("toVerify")}</Badge> : null}
                          </div>
                          {q.citation ? (
                            <p className="text-xs text-muted-foreground">
                              {tq("source")}: {q.citation}
                              {q.locator ? ` · ${q.locator}` : ""}
                            </p>
                          ) : null}
                          {cond ? (
                            <p className="text-xs text-muted-foreground">
                              {tq("appliesIf", {
                                ref: cond.ref ?? prompt(cond),
                                values: (q.appliesIfValues ?? [])
                                  .map((v) => {
                                    const o = (cond.options as ChoiceOption[] | null)?.find((x) => x.value === v);
                                    return o
                                      ? ((ar ? o.labelAr : null) ?? o.label)
                                      : ["yes", "partly", "no", "na"].includes(v)
                                        ? tv(v as "yes")
                                        : v;
                                  })
                                  .join("، "),
                              })}
                            </p>
                          ) : null}
                          {q.type === "multiple_choice" && q.options ? (
                            <ul className="text-xs text-muted-foreground">
                              {(q.options as ChoiceOption[]).map((o) => (
                                <li key={o.value}>
                                  {(ar ? o.labelAr : null) ?? o.label} · {tq("points", { n: o.points })}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        {edit ? (
                          <div className="flex shrink-0 gap-1">
                            <QuestionDialog
                              versionId={version.id}
                              sectionId={s.id}
                              position={q.position}
                              question={q as unknown as EditableQuestion}
                              targets={conditionTargets.filter((x) => x.id !== q.id)}
                            />
                            <ApiButton
                              endpoint={`/api/template-questions/${q.id}`}
                              method="DELETE"
                              label={t("delete")}
                              variant="ghost"
                              confirm={t("deleteQuestionConfirm")}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noVersion")}</p>
      )}
    </>
  );
}

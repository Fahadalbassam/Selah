"use client";

import { FileSearch, GitCompare, Save } from "lucide-react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { Paperclip } from "@/components/animate-ui/icons/paperclip";
import { RotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { Send } from "@/components/animate-ui/icons/send";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { answerValues, assessmentError, type ChoiceOption, type QuestionType } from "@/lib/assessments";
import { useConfirm } from "@/components/confirm-dialog";

/** Runs one call, says what went wrong in the assessment screens' words where it can, and refreshes. */
function useCall() {
  const te = useTranslations("assessment.errors");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(url: string, method: string, body?: unknown, done?: string): Promise<unknown> {
    setBusy(true);
    const r = await callApi(url, method, body);
    setBusy(false);
    if (!r.ok) {
      const key = assessmentError(r.message);
      toast.error(key ? te(key) : tc(`errors.${r.error}`));
      return undefined;
    }
    if (done) toast.success(done);
    router.refresh();
    return r.data ?? true;
  }
  return { busy, run };
}

function Busy({ busy, icon }: { busy: boolean; icon?: ReactNode }) {
  return busy ? <BrandLoader tone="current" className="size-4" /> : icon;
}

/** How an answer reads on screen: yes/partly/no, a rating, or a choice's label. */
export function useValueLabel() {
  const tv = useTranslations("assessment.values");
  const ar = useLocale() === "ar";
  return (value: string, options?: ChoiceOption[] | null) => {
    const o = options?.find((x) => x.value === value);
    if (o) return (ar ? o.labelAr : null) || o.label;
    if (["yes", "partly", "no", "na"].includes(value)) return tv(value as "yes");
    return value;
  };
}

/** The answer to one scored question, saved as soon as it is picked. */
export function AnswerControl(props: {
  answerId: string;
  type: QuestionType;
  value: string | null;
  textAnswer: string | null;
  options: ChoiceOption[] | null;
  readOnly: boolean;
}) {
  const t = useTranslations("assessment.run");
  const label = useValueLabel();
  const { busy, run } = useCall();
  const [text, setText] = useState(props.textAnswer ?? "");
  if (props.type === "text") {
    if (props.readOnly) return <p className="text-sm whitespace-pre-wrap">{props.textAnswer || "—"}</p>;
    return (
      <form
        className="grid gap-2"
        onSubmit={(e) => (
          e.preventDefault(),
          run(`/api/assessment-answers/${props.answerId}`, "PATCH", { textAnswer: text.trim() || null }, t("saved"))
        )}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={8000} aria-label={t("textAnswer")} />
        <Button type="submit" size="sm" variant="outline" className="w-fit" disabled={busy}>
          <Busy busy={busy} icon={<Save />} />
          {t("save")}
        </Button>
      </form>
    );
  }
  const values = answerValues({ type: props.type, options: props.options });
  if (props.readOnly)
    return (
      <p className="text-sm font-medium">
        {props.value ? label(props.value, props.options) : <span className="text-muted-foreground">{t("unanswered")}</span>}
      </p>
    );
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="flex-wrap"
      value={props.value ?? ""}
      disabled={busy}
      onValueChange={(v) => run(`/api/assessment-answers/${props.answerId}`, "PATCH", { value: v || null })}
      aria-label={t("answer")}
    >
      {values.map((v) => (
        <ToggleGroupItem key={v} value={v} className="px-3">
          {label(v, props.options)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A note on an answer: the comment (shown to the client once shared) or the firm's own note. */
export function NoteEditor(props: { answerId: string; kind: "comment" | "note"; text: string | null }) {
  const t = useTranslations("assessment.run");
  const { busy, run } = useCall();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(props.text ?? "");
  const title = props.kind === "comment" ? t("comment") : t("firmNote");
  if (!open)
    return (
      <button
        type="button"
        className="text-start text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        {props.text ? (
          <>
            <span className="font-medium text-foreground">{title}:</span> {props.text}
          </>
        ) : (
          `+ ${title}`
        )}
      </button>
    );
  async function save(e: FormEvent) {
    e.preventDefault();
    const ok =
      props.kind === "comment"
        ? await run(`/api/assessment-answers/${props.answerId}`, "PATCH", { comment: text.trim() || null }, t("saved"))
        : await run(`/api/assessment-answers/${props.answerId}/note`, "PUT", { body: text.trim() }, t("saved"));
    if (ok) setOpen(false);
  }
  return (
    <form className="grid gap-2" onSubmit={save}>
      <Label className="text-xs">
        {title}
        <span className="font-normal text-muted-foreground">
          {" "}
          · {props.kind === "comment" ? t("commentHint") : t("firmNoteHint")}
        </span>
      </Label>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} autoFocus />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          <Busy busy={busy} icon={<Save />} />
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Attach one of the project's files the firm can see. */
export function AddEvidence(props: { answerId: string; files: { id: string; title: string }[] }) {
  const t = useTranslations("assessment.run");
  const { busy, run } = useCall();
  const [pick, setPick] = useState("");
  if (!props.files.length) return null;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pick && (await run(`/api/assessment-answers/${props.answerId}/evidence/${pick}`, "PUT"))) setPick("");
      }}
    >
      <NativeSelect size="sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("attach")}>
        <NativeSelectOption value="">{t("pickFile")}</NativeSelectOption>
        {props.files.map((f) => (
          <NativeSelectOption key={f.id} value={f.id}>
            {f.title}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button type="submit" size="sm" variant="outline" disabled={busy || !pick}>
        <Busy busy={busy} icon={<Paperclip />} />
        {t("attach")}
      </Button>
    </form>
  );
}

/** A suggested gap becomes a finding only when a consultant confirms it. */
export function ConfirmGap(props: { answerId: string; prompt: string }) {
  const t = useTranslations("assessment.run");
  const tv = useTranslations("visibility");
  const tc = useTranslations("common");
  const { busy, run } = useCall();
  const [open, setOpen] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const description = String(f.get("description") ?? "").trim();
    const ok = await run(
      `/api/assessment-answers/${props.answerId}/finding`,
      "POST",
      { title: String(f.get("title") ?? "").trim(), visibility: f.get("visibility"), ...(description ? { description } : {}) },
      t("confirmed"),
    );
    if (ok) setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CircleCheck />
          {t("confirmGap")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("confirmGap")}</DialogTitle>
            <DialogDescription>{t("confirmGapHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="gap-title">{t("findingTitle")}</Label>
            <Input id="gap-title" name="title" required maxLength={300} defaultValue={props.prompt.slice(0, 300)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="gap-description">{t("findingDescription")}</Label>
            <Textarea id="gap-description" name="description" rows={3} maxLength={8000} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="gap-visibility">{t("findingVisibility")}</Label>
            <NativeSelect id="gap-visibility" name="visibility" defaultValue="shared" className="w-full">
              <NativeSelectOption value="shared">{tv("shared")}</NativeSelectOption>
              <NativeSelectOption value="firm_private">{tv("firm_private")}</NativeSelectOption>
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              <Busy busy={busy} />
              {t("confirmGap")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Finalise, share, retake. */
export function AssessmentButton(props: {
  kind: "finalise" | "share" | "unshare" | "retake";
  assessmentId: string;
  title?: string;
}) {
  const t = useTranslations("assessment.run");
  const router = useRouter();
  const { busy, run } = useCall();
  const { kind, assessmentId: id } = props;
  const [confirm, confirmDialog] = useConfirm();
  async function go() {
    if (kind === "finalise") {
      if (!(await confirm(t("finaliseConfirm")))) return;
      await run(`/api/assessments/${id}/finalise`, "POST", undefined, t("finalised"));
    } else if (kind === "share" || kind === "unshare") {
      await run(`/api/assessments/${id}/share`, "PUT", { shared: kind === "share" });
    } else {
      if (!(await confirm(t("retakeConfirm")))) return;
      const made = (await run(`/api/assessments/${id}/retake`, "POST", {})) as { id?: string } | undefined;
      if (made?.id) router.push(`/assessments/${made.id}`);
    }
  }
  const icon = { finalise: <CircleCheck />, share: <Send />, unshare: <Send />, retake: <RotateCcw /> }[kind];
  return (
    <>
      <Button size="sm" variant={kind === "finalise" ? "default" : "outline"} onClick={go} disabled={busy}>
        <Busy busy={busy} icon={icon} />
        {t(kind)}
      </Button>
      {confirmDialog}
    </>
  );
}

/** Pick another assessment of the same client on the same template to compare with. */
export function ComparePicker(props: { assessmentId: string; others: { id: string; label: string }[] }) {
  const t = useTranslations("assessment.run");
  const router = useRouter();
  const [pick, setPick] = useState(props.others[0]?.id ?? "");
  if (!props.others.length) return null;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => (e.preventDefault(), pick && router.push(`/assessments/compare?a=${props.assessmentId}&b=${pick}`))}
    >
      <NativeSelect size="sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("compareWith")}>
        {props.others.map((o) => (
          <NativeSelectOption key={o.id} value={o.id}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button type="submit" size="sm" variant="outline">
        <GitCompare />
        {t("compare")}
      </Button>
    </form>
  );
}

/** Start an assessment of a client project on a published template. */
export function StartAssessment(props: { projectId: string; templates: { id: string; label: string }[] }) {
  const t = useTranslations("assessment.run");
  const te = useTranslations("assessment.errors");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/projects/${props.projectId}/assessments`, "POST", {
      templateId: f.get("templateId"),
      title: String(f.get("title") ?? "").trim(),
    });
    setBusy(false);
    if (!r.ok) {
      const key = assessmentError(r.message);
      return setError(key ? te(key) : tc(`errors.${r.error}`));
    }
    router.push(`/assessments/${(r.data as { id: string }).id}`);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FileSearch />
          {t("start")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("start")}</DialogTitle>
            <DialogDescription>{t("startHint")}</DialogDescription>
          </DialogHeader>
          {props.templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="start-template">{t("template")}</Label>
                <NativeSelect id="start-template" name="templateId" className="w-full">
                  {props.templates.map((x) => (
                    <NativeSelectOption key={x.id} value={x.id}>
                      {x.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="start-title">{t("title")}</Label>
                <Input id="start-title" name="title" required maxLength={200} />
              </div>
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || props.templates.length === 0}>
              <Busy busy={busy} />
              {t("start")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

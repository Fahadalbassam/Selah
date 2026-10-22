"use client";

import { Pencil } from "lucide-react";
import { Plus } from "@/components/animate-ui/icons/plus";
import { X } from "@/components/animate-ui/icons/x";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  assessmentError,
  BASIS_LABELS,
  LEGAL_FORMS,
  OWN_BASES,
  QUESTION_TYPES,
  type ChoiceOption,
  type LegalForm,
  type OwnBasis,
  type QuestionType,
} from "@/lib/assessments";

export interface EditableQuestion {
  id: string;
  ref: string | null;
  prompt: string;
  promptAr: string | null;
  guidance: string | null;
  guidanceAr: string | null;
  type: QuestionType;
  options: ChoiceOption[] | null;
  weight: number;
  gapMaxPoints: number | null;
  basis: OwnBasis;
  legalFor: LegalForm[] | null;
  guidanceFor: LegalForm[] | null;
  citation: string | null;
  locator: string | null;
  citationVerified: boolean;
  appliesIfQuestionId: string | null;
  appliesIfValues: string[] | null;
}

export interface ConditionTarget {
  id: string;
  label: string;
  values: string[];
  options: ChoiceOption[] | null;
}

const blankOption = (): ChoiceOption => ({ value: "", label: "", labelAr: "", points: 0 });

/** Add or edit one question of a draft version. The database checks the rules again. */
export function QuestionDialog(props: {
  versionId: string;
  sectionId: string;
  position: number;
  question?: EditableQuestion;
  targets: ConditionTarget[];
}) {
  const t = useTranslations("assessment.question");
  const tv = useTranslations("assessment.values");
  const te = useTranslations("assessment.errors");
  const tc = useTranslations("common");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const q = props.question;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<QuestionType>(q?.type ?? "yes_no");
  const [options, setOptions] = useState<ChoiceOption[]>(q?.options ?? [blankOption(), blankOption()]);
  const [basis, setBasis] = useState<OwnBasis>(q?.basis ?? "team_proposed");
  const [legalFor, setLegalFor] = useState<LegalForm[]>(q?.legalFor ?? []);
  const [guidanceFor, setGuidanceFor] = useState<LegalForm[]>(q?.guidanceFor ?? []);
  const [verified, setVerified] = useState(q?.citationVerified ?? false);
  const [condOn, setCondOn] = useState(q?.appliesIfQuestionId ?? "");
  const [condValues, setCondValues] = useState<string[]>(q?.appliesIfValues ?? []);
  const target = props.targets.find((x) => x.id === condOn);
  const valueLabel = (tg: ConditionTarget, v: string) => {
    const o = tg.options?.find((x) => x.value === v);
    return o ? ((ar ? o.labelAr : null) ?? o.label) : tv(v as never);
  };

  // A form is bound by law for some legal forms or guided for others, never both.
  function toggle(list: "legal" | "guidance", form: LegalForm, on: boolean) {
    const [mine, setMine, setOther] =
      list === "legal" ? [legalFor, setLegalFor, setGuidanceFor] : [guidanceFor, setGuidanceFor, setLegalFor];
    setMine(on ? [...mine, form] : mine.filter((f) => f !== form));
    if (on) setOther((other) => other.filter((f) => f !== form));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim() || null;
    const gap = text("gapMaxPoints");
    const body = {
      sectionId: props.sectionId,
      position: props.position,
      ref: text("ref"),
      prompt: text("prompt"),
      promptAr: text("promptAr"),
      guidance: text("guidance"),
      guidanceAr: text("guidanceAr"),
      type,
      options:
        type === "multiple_choice"
          ? options.map((o) => ({
              value: o.value.trim(),
              label: o.label.trim(),
              points: o.points,
              ...(o.labelAr?.trim() ? { labelAr: o.labelAr.trim() } : {}),
            }))
          : null,
      weight: Number(form.get("weight") ?? 1),
      gapMaxPoints: type === "text" || gap === null ? null : Number(gap),
      basis,
      legalFor: legalFor.length ? legalFor : null,
      guidanceFor: guidanceFor.length ? guidanceFor : null,
      citation: text("citation"),
      locator: text("locator"),
      citationVerified: verified,
      appliesIfQuestionId: condOn || null,
      appliesIfValues: condOn && condValues.length ? condValues : null,
    };
    setBusy(true);
    setError(null);
    const r = q
      ? await callApi(`/api/template-questions/${q.id}`, "PATCH", body)
      : await callApi(`/api/template-versions/${props.versionId}/questions`, "POST", body);
    setBusy(false);
    if (!r.ok) {
      const key = assessmentError(r.message);
      return setError(key ? te(key) : tc(`errors.${r.error}`));
    }
    setOpen(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        {q ? (
          <Button size="sm" variant="ghost">
            <Pencil />
            {t("edit")}
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus />
            {t("add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{q ? t("edit") : t("add")}</DialogTitle>
            <DialogDescription>{t("hint")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-[6rem_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="q-ref">{t("ref")}</Label>
              <Input id="q-ref" name="ref" maxLength={20} defaultValue={q?.ref ?? ""} dir="ltr" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="q-prompt">{t("prompt")}</Label>
              <Textarea id="q-prompt" name="prompt" required maxLength={1000} rows={2} defaultValue={q?.prompt ?? ""} dir="ltr" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="q-promptAr">{t("promptAr")}</Label>
            <Textarea id="q-promptAr" name="promptAr" maxLength={1000} rows={2} defaultValue={q?.promptAr ?? ""} dir="rtl" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="q-guidance">{t("guidance")}</Label>
              <Textarea id="q-guidance" name="guidance" maxLength={4000} rows={2} defaultValue={q?.guidance ?? ""} dir="ltr" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="q-guidanceAr">{t("guidanceAr")}</Label>
              <Textarea
                id="q-guidanceAr"
                name="guidanceAr"
                maxLength={4000}
                rows={2}
                defaultValue={q?.guidanceAr ?? ""}
                dir="rtl"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="q-type">{t("type")}</Label>
              <NativeSelect id="q-type" value={type} onChange={(e) => setType(e.target.value as QuestionType)} className="w-full">
                {QUESTION_TYPES.map((x) => (
                  <NativeSelectOption key={x} value={x}>
                    {t(`types.${x}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            {type !== "text" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="q-weight">{t("weight")}</Label>
                  <NativeSelect id="q-weight" name="weight" defaultValue={String(q?.weight ?? 1)} className="w-full">
                    {[1, 2, 3].map((w) => (
                      <NativeSelectOption key={w} value={w}>
                        {w}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="q-gap">{t("gapMax")}</Label>
                  <Input
                    id="q-gap"
                    name="gapMaxPoints"
                    type="number"
                    min={0}
                    max={30}
                    defaultValue={q?.gapMaxPoints ?? ""}
                    placeholder={t("gapDefault")}
                  />
                </div>
              </>
            ) : null}
          </div>

          {type === "multiple_choice" ? (
            <fieldset className="grid gap-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{t("options")}</legend>
              {options.map((o, i) => (
                <div key={i} className="grid grid-cols-[6rem_1fr_1fr_4.5rem_auto] items-center gap-2">
                  <Input
                    aria-label={t("optionValue")}
                    placeholder={t("optionValue")}
                    value={o.value}
                    dir="ltr"
                    required
                    maxLength={50}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                  <Input
                    aria-label={t("optionLabel")}
                    placeholder={t("optionLabel")}
                    value={o.label}
                    dir="ltr"
                    required
                    maxLength={200}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <Input
                    aria-label={t("optionLabelAr")}
                    placeholder={t("optionLabelAr")}
                    value={o.labelAr ?? ""}
                    dir="rtl"
                    maxLength={200}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, labelAr: e.target.value } : x)))}
                  />
                  <Input
                    aria-label={t("optionPoints")}
                    type="number"
                    min={0}
                    max={10}
                    value={o.points}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("removeOption")}
                    disabled={options.length <= 2}
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              {options.length < 10 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={() => setOptions([...options, blankOption()])}
                >
                  <Plus />
                  {t("addOption")}
                </Button>
              ) : null}
            </fieldset>
          ) : null}

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("basisTitle")}</legend>
            <p className="text-xs text-muted-foreground">{t("basisHint")}</p>
            <NativeSelect
              value={basis}
              onChange={(e) => setBasis(e.target.value as OwnBasis)}
              aria-label={t("basis")}
              className="w-full"
            >
              {OWN_BASES.map((b) => (
                <NativeSelectOption key={b} value={b}>
                  {ar ? BASIS_LABELS[b].ar : BASIS_LABELS[b].en}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {(["legal", "guidance"] as const).map((list) => (
              <div key={list} className="grid gap-2">
                <span className="text-sm">{list === "legal" ? t("legalForLabel") : t("guidanceForLabel")}</span>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {LEGAL_FORMS.map((f) => {
                    const checked = (list === "legal" ? legalFor : guidanceFor).includes(f);
                    return (
                      <label key={f} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={checked} onCheckedChange={(on) => toggle(list, f, on === true)} />
                        {t(`forms.${f}`)}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <div className="grid gap-2">
                <Label htmlFor="q-citation">{t("citation")}</Label>
                <Input id="q-citation" name="citation" maxLength={500} defaultValue={q?.citation ?? ""} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="q-locator">{t("locator")}</Label>
                <Input
                  id="q-locator"
                  name="locator"
                  maxLength={200}
                  defaultValue={q?.locator ?? ""}
                  placeholder={t("locatorPlaceholder")}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={verified} onCheckedChange={setVerified} />
              {t("verified")}
            </label>
          </fieldset>

          {props.targets.length ? (
            <fieldset className="grid gap-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{t("condition")}</legend>
              <NativeSelect
                value={condOn}
                onChange={(e) => (setCondOn(e.target.value), setCondValues([]))}
                aria-label={t("condition")}
                className="w-full"
              >
                <NativeSelectOption value="">{t("always")}</NativeSelectOption>
                {props.targets.map((x) => (
                  <NativeSelectOption key={x.id} value={x.id}>
                    {x.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {target ? (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {target.values.map((v) => (
                    <label key={v} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={condValues.includes(v)}
                        onCheckedChange={(on) =>
                          setCondValues(on === true ? [...condValues, v] : condValues.filter((x) => x !== v))
                        }
                      />
                      {valueLabel(target, v)}
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? tc("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { INDICATOR_DIRECTIONS, INDICATOR_FREQUENCIES, INDICATOR_LIMITS as L, periodLabel, type IndicatorFrequency } from "@/lib/indicators";

/** Maps a data rule's words (or the route's) to a message key under indicators.errors. */
function indicatorError(message: string | undefined, error: string) {
  const m = message ?? "";
  if (m.includes("start a new indicator")) return "locked";
  if (m.includes("switch it off instead")) return "hasValues";
  if (m.includes("correct it instead")) return "filled";
  if (m.includes("not started yet")) return "future";
  if (m.includes("one of the indicator's periods")) return "period";
  if (m.includes("active indicators")) return "inactive";
  if (m.includes("archived")) return "archived";
  if (m.includes("someone other")) return "ownValue";
  if (m.includes("checked, once") || m.includes("was corrected")) return "checked";
  if (m.includes("department")) return "department";
  return error === "invalid" ? "invalid" : "cannot";
}

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `after` returns true when it navigated away, so there is nothing to refresh. */
  async function send(url: string, method: string, body: unknown, done: string, after?: (data: unknown) => boolean | void) {
    setBusy(true);
    setError(null);
    const r = await callApi(url, method, body);
    setBusy(false);
    if (!r.ok) return void setError(indicatorError(r.message, r.error));
    toast.success(done);
    if (!after?.(r.data)) router.refresh();
  }
  return { busy, error, setError, send };
}

function Footer({ busy, error, label, onCancel }: { busy: boolean; error: string | null; label: string; onCancel: () => void }) {
  const t = useTranslations("indicators");
  const tc = useTranslations("common");
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : null}
          {busy ? tc("saving") : label}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface IndicatorValues {
  id: string;
  nameAr: string | null;
  nameEn: string | null;
  definition: string | null;
  unit: string;
  direction: string;
  frequency: string;
  baseline: number;
  baselinePeriod: string;
  target: number | null;
  targetDate: string | null;
  source: string | null;
  departmentId: string | null;
}

const number = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace("٫", ".").replace(/[,،\s]/g, "");
  return s === "" ? null : Number(s);
};

/**
 * Set up an indicator, or change one. Once it has values its baseline,
 * frequency and direction are fixed (the database says the same), so the
 * dialog shows them but won't change them.
 */
export function IndicatorDialog({
  clientOrgId,
  indicator,
  locked = false,
  departments,
  defaultDepartmentId = null,
  trigger,
}: {
  clientOrgId: string;
  /** Present when editing. */
  indicator?: IndicatorValues;
  locked?: boolean;
  departments: { id: string; nameAr: string; nameEn: string | null }[];
  defaultDepartmentId?: string | null;
  trigger: ReactNode;
}) {
  const t = useTranslations("indicators");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState(indicator?.direction ?? "higher_better");
  const [frequency, setFrequency] = useState(indicator?.frequency ?? "monthly");
  const [department, setDepartment] = useState(indicator?.departmentId ?? defaultDepartmentId ?? "company");
  const { busy, error, setError, send } = useSend();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim() || null;
    const month = text("baselinePeriod");
    const target = number(form.get("target"));
    const targetDate = text("targetDate");
    const values = number(form.get("baseline"));
    if (!text("nameAr") && !text("nameEn")) return setError("name");
    if (values === null || Number.isNaN(values) || (target !== null && Number.isNaN(target))) return setError("number");
    if ((target === null) !== (targetDate === null)) return setError("targetPair");
    const body = {
      nameAr: text("nameAr"),
      nameEn: text("nameEn"),
      definition: text("definition"),
      unit: text("unit") ?? "",
      source: text("source"),
      target,
      targetDate,
      departmentId: department === "company" ? null : department,
      ...(locked ? {} : { direction, frequency, baseline: values, baselinePeriod: month ? `${month}-01` : "" }),
    };
    void send(
      indicator ? `/api/indicators/${indicator.id}` : `/api/clients/${clientOrgId}/indicators`,
      indicator ? "PATCH" : "POST",
      body,
      t(indicator ? "saved" : "created"),
      (data) => {
        setOpen(false);
        const id = (data as { id?: string } | null)?.id;
        if (indicator || !id) return false;
        router.push(`/indicators/${id}`);
        return true;
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{indicator ? t("editTitle") : t("newTitle")}</DialogTitle>
            <DialogDescription>{t("newHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="k-name-ar">{t("fields.nameAr")}</Label>
              <Input id="k-name-ar" name="nameAr" dir="rtl" maxLength={L.name} defaultValue={indicator?.nameAr ?? ""} placeholder={t("fields.nameArPlaceholder")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="k-name-en">{t("fields.nameEn")}</Label>
              <Input id="k-name-en" name="nameEn" dir="ltr" maxLength={L.name} defaultValue={indicator?.nameEn ?? ""} placeholder={t("fields.nameEnPlaceholder")} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="k-def">{t("fields.definition")}</Label>
            <Textarea id="k-def" name="definition" rows={2} dir="auto" maxLength={L.definition} defaultValue={indicator?.definition ?? ""} placeholder={t("fields.definitionPlaceholder")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="k-unit">{t("fields.unit")}</Label>
              <Input id="k-unit" name="unit" required dir="auto" maxLength={L.unit} defaultValue={indicator?.unit ?? ""} placeholder={t("fields.unitPlaceholder")} />
            </div>
            {departments.length ? (
              <div className="grid gap-2">
                <Label htmlFor="k-dept">{t("fields.scope")}</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger id="k-dept" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">{t("company")}</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {ar ? d.nameAr : (d.nameEn ?? d.nameAr)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="k-dir">{t("fields.direction")}</Label>
              <Select value={direction} onValueChange={setDirection} disabled={locked}>
                <SelectTrigger id="k-dir" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDICATOR_DIRECTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`directions.${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="k-freq">{t("fields.frequency")}</Label>
              <Select value={frequency} onValueChange={setFrequency} disabled={locked}>
                <SelectTrigger id="k-freq" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDICATOR_FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`frequencies.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="k-base">{t("fields.baseline")}</Label>
              <Input id="k-base" name="baseline" required inputMode="decimal" dir="ltr" disabled={locked} defaultValue={indicator ? String(indicator.baseline) : ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="k-base-month">{t("fields.baselinePeriod")}</Label>
              <Input
                id="k-base-month"
                name="baselinePeriod"
                type="month"
                required
                dir="ltr"
                disabled={locked}
                defaultValue={indicator ? indicator.baselinePeriod.slice(0, 7) : ""}
              />
            </div>
          </div>
          {locked ? <p className="-mt-2 text-xs text-muted-foreground">{t("lockedHint")}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="k-target">{t("fields.target")}</Label>
              <Input id="k-target" name="target" inputMode="decimal" dir="ltr" defaultValue={indicator?.target === null || !indicator ? "" : String(indicator.target)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="k-target-date">{t("fields.targetDate")}</Label>
              <DatePicker id="k-target-date" name="targetDate" defaultValue={indicator?.targetDate ?? undefined} placeholder={t("fields.targetDate")} clearLabel={t("clear")} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t("targetHint")}</p>
          <div className="grid gap-2">
            <Label htmlFor="k-source">{t("fields.source")}</Label>
            <Input id="k-source" name="source" dir="auto" maxLength={L.source} defaultValue={indicator?.source ?? ""} placeholder={t("fields.sourcePlaceholder")} />
          </div>
          <Footer busy={busy} error={error} label={indicator ? t("save") : t("create")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Enter a value for a period, or correct the period's current value. The
 * person's name goes on it; a firm person's value is marked as entered for
 * the client, and the client's admins are told.
 */
export function ValueDialog({
  indicatorId,
  unit,
  frequency,
  periods,
  correct,
  onBehalf,
  trigger,
}: {
  indicatorId: string;
  unit: string;
  frequency: IndicatorFrequency;
  /** Periods that can take a first value, newest first. */
  periods: string[];
  /** A correction: the period and the value it replaces. */
  correct?: { period: string; valueId: string; value: number };
  /** The firm entering it for the client. */
  onBehalf: boolean;
  trigger: ReactNode;
}) {
  const t = useTranslations("indicators");
  const locale = useLocale() as "ar" | "en";
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(correct?.period ?? periods[0] ?? "");
  const { busy, error, setError, send } = useSend();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = number(form.get("value"));
    if (value === null || Number.isNaN(value)) return setError("number");
    void send(
      `/api/indicators/${indicatorId}/values`,
      "POST",
      { period, value, note: String(form.get("note") ?? "").trim() || null, supersedesId: correct?.valueId ?? null },
      t(correct ? "corrected" : "entered"),
      () => setOpen(false),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{correct ? t("correctTitle") : t("valueTitle")}</DialogTitle>
            <DialogDescription>{onBehalf ? t("valueHintFirm") : t("valueHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="v-period">{t("fields.period")}</Label>
            {correct ? (
              <p id="v-period" className="text-sm">
                {periodLabel(correct.period, frequency, locale)}
              </p>
            ) : (
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger id="v-period" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p} value={p}>
                      {periodLabel(p, frequency, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v-value">{t("fields.value", { unit })}</Label>
            <Input id="v-value" name="value" required inputMode="decimal" dir="ltr" defaultValue={correct ? String(correct.value) : ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="v-note">{correct ? t("fields.correctionNote") : t("fields.note")}</Label>
            <Textarea id="v-note" name="note" rows={3} dir="auto" maxLength={L.note} required={!!correct} placeholder={t("fields.notePlaceholder")} />
          </div>
          <Footer busy={busy} error={error} label={correct ? t("correct") : t("enter")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Link a recommendation of the same client: it is meant to move this indicator. */
export function LinkDialog({
  options,
  trigger,
}: {
  /** value: "indicatorId:recommendationId". */
  options: { value: string; label: string; group?: string }[];
  trigger: ReactNode;
}) {
  const t = useTranslations("indicators");
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const { busy, error, setError, send } = useSend();
  const groups = [...new Set(options.map((o) => o.group))];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!choice) return;
    const [kpi, rec] = choice.split(":") as [string, string];
    void send(`/api/indicators/${kpi}/links`, "POST", { recommendationId: rec }, t("linked"), () => {
      setOpen(false);
      setChoice("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("linkTitle")}</DialogTitle>
            <DialogDescription>{t("linkHint")}</DialogDescription>
          </DialogHeader>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="w-full" aria-label={t("linkTitle")}>
              <SelectValue placeholder={t("linkPick")} />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectGroup key={g ?? "-"}>
                  {g ? <SelectLabel dir="auto">{g}</SelectLabel> : null}
                  {options
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <span dir="auto">{o.label}</span>
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Footer busy={busy} error={error} label={t("link")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

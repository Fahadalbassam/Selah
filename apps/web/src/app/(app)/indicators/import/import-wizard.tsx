"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Upload } from "@/components/animate-ui/icons/upload";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { StatTile } from "@/components/stat-tile";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { formatValue, periodLabel } from "@/lib/indicators";
import { MAX_IMPORT_VALUES, detectShape, matchLabels, planCounts, planValues, readValues, type Layout, type TableShape } from "@/lib/indicator-import";
import type { IndicatorImportContext } from "@/services/indicator-data";
import { cn } from "@/lib/utils";

// Importing indicator figures from a client's export, in three steps on one
// page: the file (checked, scanned and read on the server), its shape and
// which indicator each label is (matched by code or name, changeable), and
// the figures (checked by the same code the server runs again on confirm).
// Nothing is saved until the person confirms.

interface Parsed {
  token: string;
  fileName: string;
  sheets: { name: string; rows: string[][] }[];
}

type Step = "upload" | "match" | "review";
const NONE = "none";

function errorKey(status: number, message: string | undefined): string {
  const m = message ?? "";
  if (status === 503) return "scanner";
  if (m.includes("infected")) return "infected";
  if (m.includes("too large") || m.includes("too_large")) return "too_large";
  if (m.includes("rejected")) return "type";
  if (m.includes("nothing to import")) return "nothing";
  if (m.includes("expired")) return "expired";
  if (m.includes("rows with errors")) return "changed";
  if (m.includes("too many")) return "tooMany";
  if (m.includes("shares no files")) return "typed";
  return "generic";
}

const letters = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function IndicatorImportWizard({ clientId, ctx, onBehalf }: { clientId: string; ctx: IndicatorImportContext; onBehalf: boolean }) {
  const t = useTranslations("indicatorImport");
  const ti = useTranslations("indicators");
  const ar = useLocale() === "ar";
  const lang = ar ? "ar" : "en";
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();

  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [sheet, setSheet] = useState(0);
  const [shape, setShape] = useState<TableShape | null>(null);
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [corrections, setCorrections] = useState(false);

  const active = ctx.indicators.filter((k) => k.active);
  const name = (id: string) => {
    const k = ctx.indicators.find((x) => x.id === id);
    return k ? ((ar ? (k.nameAr ?? k.nameEn) : (k.nameEn ?? k.nameAr)) ?? "") : "";
  };
  const rows = parsed?.sheets[sheet]?.rows;
  const read = useMemo(() => (shape && rows ? readValues(rows, shape) : []), [rows, shape]);
  const labels = useMemo(() => [...new Set(read.map((v) => v.label))], [read]);
  const labelMap = useMemo(() => matchLabels(labels, ctx.indicators, chosen), [labels, ctx.indicators, chosen]);
  const currentList = ctx.current;
  const current = useMemo(() => new Map(currentList.map((c) => [c.key, { id: c.id, value: c.value }])), [currentList]);
  const plan = useMemo(
    () => planValues(read, labelMap, ctx.indicators, current, { today: ctx.today, corrections }),
    [read, labelMap, ctx.indicators, current, ctx.today, corrections],
  );
  const counts = planCounts(plan);

  function chooseSheet(i: number, p = parsed) {
    setSheet(i);
    setChosen({});
    setShape(detectShape(p?.sheets[i]?.rows ?? []));
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return setError("empty");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/indicator-data/import`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as Parsed & { message?: string };
      if (!res.ok) return setError(errorKey(res.status, body.message));
      setParsed(body);
      // The sheet with the most figures read is the likely one.
      const best = body.sheets.map((s) => readValues(s.rows, detectShape(s.rows)).length).reduce((b, n, i, all) => (n > all[b]! ? i : b), 0);
      chooseSheet(best, body);
      setStep("match");
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!(await confirm(t("review.confirm", { add: counts.add, correct: counts.correct })))) return;
    setBusy(true);
    setError(null);
    const saved = counts.add + counts.correct;
    try {
      const res = await fetch(`/api/clients/${clientId}/indicator-data/import/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: parsed!.token,
          sheet,
          rows: rows ?? [],
          shape,
          chosen,
          corrections,
          expect: { add: counts.add, correct: counts.correct },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) return setError(errorKey(res.status, body.message));
      toast.success(t("review.done", { n: saved }));
      router.push(`/indicators/data?client=${clientId}`);
      router.refresh();
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  const errorText = error ? t(`errors.${error}`, { max: MAX_IMPORT_VALUES }) : null;
  const header = shape ? (rows?.[shape.headerRow] ?? []) : [];
  const colOptions = header.map((h, i) => ({ value: String(i), label: `${letters(i)}${h ? ` · ${h.slice(0, 40)}` : ""}` }));
  const colSelect = (id: string, labelKey: string, value: number | null, onChange: (v: number | null) => void, optional = false) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <Select value={value === null ? NONE : String(value)} onValueChange={(v) => onChange(v === NONE ? null : Number(v))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value={NONE}>{t("match.noColumn")}</SelectItem> : null}
          {colOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      {confirmDialog}
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("title")}>
        {(["upload", "match", "review"] as const).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            {i ? (
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
            ) : null}
            <span aria-current={step === s ? "step" : undefined} className={cn(step === s ? "font-medium text-foreground" : "text-muted-foreground")}>
              {i + 1}. {t(`steps.${s}`)}
            </span>
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("upload.title")}</CardTitle>
              <CardDescription>{onBehalf ? t("upload.hintFirm") : t("upload.hint")}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              {active.length ? (
                <form onSubmit={upload} className="grid max-w-lg gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="kpi-file">{t("upload.file")}</Label>
                    <Input id="kpi-file" name="file" type="file" accept=".xlsx,.csv" required aria-invalid={!!error} />
                  </div>
                  {errorText ? (
                    <p role="alert" className="text-xs text-destructive">
                      {errorText}
                    </p>
                  ) : null}
                  <Button type="submit" className="w-fit" disabled={busy}>
                    {busy ? <BrandLoader tone="current" className="size-4" /> : <Upload animateOnHover />}
                    {busy ? t("upload.reading") : t("upload.read")}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">{t("upload.noIndicators")}</p>
              )}
            </CardContent>
          </Card>
          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("upload.shapesTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5 text-sm text-muted-foreground">
              <p>{t("upload.rows")}</p>
              <p>{t("upload.columns")}</p>
              <p>{t("upload.list")}</p>
              <p className="text-xs">{t("upload.periods")}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {step === "match" && parsed && shape ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("match.title")}</CardTitle>
            <CardDescription>{t("match.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 px-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("match.file")}:</span>
              <bdi className="font-medium">{parsed.fileName}</bdi>
              <Button variant="ghost" size="sm" onClick={() => (setParsed(null), setStep("upload"))}>
                {t("match.another")}
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {parsed.sheets.length > 1 ? (
                <div className="grid gap-2">
                  <Label htmlFor="kpi-sheet">{t("match.sheet")}</Label>
                  <Select value={String(sheet)} onValueChange={(v) => chooseSheet(Number(v))}>
                    <SelectTrigger id="kpi-sheet" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {parsed.sheets.map((s, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="kpi-layout">{t("match.layout")}</Label>
                <Select value={shape.layout} onValueChange={(v) => setShape({ ...shape, layout: v as Layout, labelCol: shape.labelCol ?? 0, valueCol: shape.valueCol ?? 1, periodCol: shape.periodCol ?? 0 })}>
                  <SelectTrigger id="kpi-layout" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["rows", "columns", "list"] as const).map((l) => (
                      <SelectItem key={l} value={l}>
                        {t(`layouts.${l}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="kpi-header">{t("match.headerRow")}</Label>
                <Select value={String(shape.headerRow)} onValueChange={(v) => setShape({ ...shape, headerRow: Number(v) })}>
                  <SelectTrigger id="kpi-header" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(rows ?? []).slice(0, 15).map((r, i) =>
                      r.some((c) => c.trim()) ? (
                        <SelectItem key={i} value={String(i)}>
                          {t("match.row", { n: i + 1 })}: {r.filter(Boolean).slice(0, 3).join("، ").slice(0, 60)}
                        </SelectItem>
                      ) : null,
                    )}
                  </SelectContent>
                </Select>
              </div>
              {shape.layout === "rows" ? colSelect("kpi-label-col", "match.labelCol", shape.labelCol, (v) => setShape({ ...shape, labelCol: v })) : null}
              {shape.layout !== "rows" ? colSelect("kpi-period-col", "match.periodCol", shape.periodCol, (v) => setShape({ ...shape, periodCol: v })) : null}
              {shape.layout === "list" ? (
                <>
                  {colSelect("kpi-label-col", "match.labelCol", shape.labelCol, (v) => setShape({ ...shape, labelCol: v }))}
                  {colSelect("kpi-value-col", "match.valueCol", shape.valueCol, (v) => setShape({ ...shape, valueCol: v }))}
                  {colSelect("kpi-note-col", "match.noteCol", shape.noteCol, (v) => setShape({ ...shape, noteCol: v }), true)}
                </>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("match.labelsTitle", { n: labels.length })}</p>
              {labels.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("match.inFile")}</TableHead>
                      <TableHead>{t("match.indicator")}</TableHead>
                      <TableHead>{t("match.figures")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {labels.map((l) => (
                      <TableRow key={l}>
                        <TableCell dir="auto" className="max-w-64 truncate">
                          {l}
                        </TableCell>
                        <TableCell>
                          <Select value={labelMap[l] ?? NONE} onValueChange={(v) => setChosen({ ...chosen, [l]: v === NONE ? null : v })}>
                            <SelectTrigger className="w-72" aria-label={t("match.indicator")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{t("match.leaveOut")}</SelectItem>
                              {active.map((k) => (
                                <SelectItem key={k.id} value={k.id}>
                                  {name(k.id)} ({k.unit})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{read.filter((v) => v.label === l).length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{t("match.nothingRead")}</p>
              )}
            </div>
            <div>
              <Button disabled={!plan.some((p) => p.kpiId)} onClick={() => setStep("review")}>
                {t("match.next")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "review" && parsed ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label={t("review.add")} value={counts.add} />
            <StatTile label={t("review.correct")} value={counts.correct} />
            <StatTile label={t("review.same")} value={counts.same} />
            <StatTile label={t("review.left")} value={counts.left} />
          </div>
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 px-5">
              <div className="space-y-1.5">
                <CardTitle className="text-base">{t("review.title")}</CardTitle>
                <CardDescription>{onBehalf ? t("review.hintFirm") : t("review.hint")}</CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={corrections} onCheckedChange={setCorrections} />
                {t("review.corrections")}
              </label>
            </CardHeader>
            <CardContent className="grid gap-4 px-5">
              <div className="max-h-[28rem] overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("review.row")}</TableHead>
                      <TableHead>{t("match.indicator")}</TableHead>
                      <TableHead>{t("review.period")}</TableHead>
                      <TableHead>{t("review.value")}</TableHead>
                      <TableHead>{t("review.outcome")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.map((p, i) => {
                      const k = p.kpiId ? ctx.indicators.find((x) => x.id === p.kpiId) : undefined;
                      return (
                        <TableRow key={i} className={cn(p.issue && p.issue !== "keep" && "text-muted-foreground")}>
                          <TableCell className="tabular-nums">{p.line}</TableCell>
                          <TableCell dir="auto">{k ? name(k.id) : <span className="italic">{p.label}</span>}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.period && k ? periodLabel(p.period, k.frequency, lang) : (read[i]?.rawPeriod ?? "—")}</TableCell>
                          <TableCell className="tabular-nums" dir="auto">
                            {p.value === null || Number.isNaN(p.value) ? (read[i]?.rawValue ?? "—") : formatValue(p.value, lang)}
                            {p.status === "correct" && p.current ? (
                              <span className="ms-2 text-xs text-muted-foreground line-through">{formatValue(p.current.value, lang)}</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {p.status ? (
                              <ToneBadge tone={p.status === "add" ? "active" : p.status === "correct" ? "waiting" : "neutral"}>{t(`outcomes.${p.status}`)}</ToneBadge>
                            ) : (
                              <Badge variant="outline">{t(`issues.${p.issue}`)}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">{ti("claimNote")}</p>
              {errorText ? (
                <p role="alert" className="text-xs text-destructive">
                  {errorText}
                </p>
              ) : counts.add + counts.correct > MAX_IMPORT_VALUES ? (
                <p role="alert" className="text-xs text-destructive">
                  {t("errors.tooMany", { max: MAX_IMPORT_VALUES })}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setStep("match")}>
                  {t("review.back")}
                </Button>
                <Button disabled={busy || counts.add + counts.correct === 0 || counts.add + counts.correct > MAX_IMPORT_VALUES} onClick={() => void save()}>
                  {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                  {t("review.save", { n: counts.add + counts.correct })}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}

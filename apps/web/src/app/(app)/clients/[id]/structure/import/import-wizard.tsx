"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Upload } from "@/components/animate-ui/icons/upload";
import { Hint } from "@/components/hint";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { ExportButton } from "@/components/export-button";
import { SectionHeader } from "@/components/section-header";
import { StatTile } from "@/components/stat-tile";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  checkOrgImport,
  ORG_IMPORT_FIELDS,
  ORG_IMPORT_LIMITS,
  parseYesNo,
  removedIfSkipped,
  type Dropped,
  type OrgField,
  type OrgImportContext,
  type OrgImportMode,
  type OrgImportSource,
  type OrgIssue,
  type OrgRow,
  type OrgRowCheck,
} from "@/lib/org-chart-import";
import { cn } from "@/lib/utils";

// Org chart, part 4: bringing a client's structure into the firm's draft, in
// two steps on one page. First the way in, one main action each: the Excel
// template (download it, or the draft in it, then upload), a Word outline,
// or pasted text for the assistant (only where the assistant is on). Then
// one review step for all three: every row, checked as it is edited by the
// same code the server runs again on saving, with fixes in place or "skip
// this row". Nothing is saved until "Save to draft", and nothing is
// published here. Selah checks the data only; it never comments on the
// structure itself.

interface Imported {
  token: string;
  fileName: string | null;
  source: OrgImportSource;
  rows: OrgRow[];
  dropped: Dropped[];
}

type Step = "source" | "review";
type Way = "excel" | "word" | "text";

/** A refusal as an "orgChartImport.errors" key. */
function errorKey(status: number, message: string | undefined, way: Way): string {
  const m = message ?? "";
  if (status === 429) return "rate";
  if (status === 503) return way === "text" ? "model" : "scanner";
  if (m.includes("infected")) return "infected";
  if (m.includes("too large") || m.includes("too_large")) return "too_large";
  if (m.includes("rejected: empty")) return "empty";
  if (m.includes("rejected: unsafe")) return "unsafe";
  if (m.includes("rejected")) return "type";
  if (m.includes("not the template")) return "notTemplate";
  if (m.includes("no headings")) return "noHeadings";
  if (m.includes("nothing to import")) return "nothing";
  if (m.includes("no text")) return "noText";
  if (m.includes("text too long")) return "textLong";
  if (m.includes("local model only")) return "notHere";
  if (m.includes("expired")) return "expired";
  if (m.includes("rows with errors")) return "changed";
  return "generic";
}

export function OrgChartImportWizard({
  clientId,
  ctx,
  assistant,
  draft,
}: {
  clientId: string;
  ctx: OrgImportContext;
  /** The assistant is on for this reader at this client: the paste option shows. */
  assistant: boolean;
  /** What the draft holds now, when it holds anything: saving asks whether to replace it or add to it. */
  draft: { units: number; positions: number } | null;
}) {
  const t = useTranslations("orgChartImport");
  const tf = useTranslations("orgChartImport.fields");
  const tk = useTranslations("orgChartImport.kinds");
  const router = useRouter();
  const locale = useLocale();
  const [confirm, confirmDialog] = useConfirm();

  const [step, setStep] = useState<Step>("source");
  const [way, setWay] = useState<Way>("excel");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Too long": by how many characters the text must be shorter (the server counts it after hiding names).
  const [shorterBy, setShorterBy] = useState(0);
  const [imported, setImported] = useState<Imported | null>(null);
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [mode, setMode] = useState<OrgImportMode | null>(draft ? null : "add");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<OrgRow | null>(null);
  // Replacing removes what the rows do not hold: the person ticks that they have looked at it.
  const [leavingSeen, setLeavingSeen] = useState(false);

  function received(body: Imported) {
    setImported(body);
    setRows(body.rows);
    setMode(draft ? null : "add");
    setLeavingSeen(false);
    setStep("review");
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return setError("empty");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/structure/import`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as Imported & { message?: string };
      if (!res.ok) return setError(errorKey(res.status, body.message, way));
      received(body);
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  async function draftText(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!text.trim()) return setError("noText");
    if (text.length > ORG_IMPORT_LIMITS.text) {
      setShorterBy(text.length - ORG_IMPORT_LIMITS.text);
      return setError("textLong");
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/structure/import/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json().catch(() => ({}))) as Imported & { message?: string };
      if (!res.ok) {
        setShorterBy(Number(/text too long: (\d+)/.exec(body.message ?? "")?.[1] ?? 0));
        return setError(errorKey(res.status, body.message, "text"));
      }
      received(body);
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  const check = useMemo(() => checkOrgImport(rows, ctx, mode ?? "add"), [rows, ctx, mode]);
  const byLine = useMemo(() => new Map(check.rows.map((r) => [r.line, r])), [check]);
  const nothing = check.counts.units + check.counts.positions === 0;
  const leaving = mode === "replace" ? check.plan.leaving : { positions: [], units: [] };
  const mustSeeLeaving = leaving.positions.length + leaving.units.length > 0 && !leavingSeen;
  const blocked = busy || !mode || check.counts.withErrors > 0 || check.tooMany || nothing || mustSeeLeaving;
  /** In Replace, what "Skip this row" takes out of the draft (only rows with an error show the button). */
  const skipEffect = (r: OrgRow) => (mode === "replace" && byLine.get(r.line)?.errors.length ? removedIfSkipped(rows, r.line, ctx, mode) : null);

  async function save() {
    const c = check.counts;
    const message =
      mode === "replace"
        ? t("review.confirmReplace", { units: c.units, positions: c.positions, removedUnits: c.removeUnits, removedPositions: c.removePositions })
        : t("review.confirm", { units: c.units, positions: c.positions });
    if (!(await confirm(message))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/structure/import/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: imported!.token,
          rows: rows.filter((r) => r.include).map((r) => ({ line: r.line, values: r.values })),
          ...(draft ? { mode } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) return setError(errorKey(res.status, body.message, way));
      toast.success(t("review.done"));
      router.push(`/clients/${clientId}/structure?version=draft`);
      router.refresh();
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  const issueText = (i: OrgIssue) => {
    const v = i.values ?? {};
    return t(`issues.${i.code}`, {
      field: i.field ? tf(i.field) : "",
      code: v.code ?? "",
      line: v.line ?? "",
      value: v.value ?? "",
      level: v.level ?? "",
      parent: v.parent ?? "",
      planned: v.planned ?? "",
      count: v.count ?? "",
      max: v.max ?? "",
      kind: typeof v.kind === "string" ? tk(v.kind) : "",
    });
  };
  const errorText = error ? t(`errors.${error}`, { max: ORG_IMPORT_LIMITS.text, n: shorterBy }) : null;
  const alert = errorText ? (
    <p role="alert" className="text-xs text-destructive">
      {errorText}
    </p>
  ) : null;

  return (
    <>
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("title")}>
        {(["source", "review"] as const).map((s, i) => (
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

      {step === "source" ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("source.title")}</CardTitle>
            <CardDescription>{t("source.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            <Tabs
              value={way}
              onValueChange={(v) => {
                setWay(v as Way);
                setError(null);
              }}
            >
              <TabsList>
                <TabsTrigger value="excel">{t("source.excel")}</TabsTrigger>
                <TabsTrigger value="word">{t("source.word")}</TabsTrigger>
                {assistant ? <TabsTrigger value="text">{t("source.text")}</TabsTrigger> : null}
              </TabsList>

              <TabsContent value="excel" className="grid max-w-2xl gap-4 pt-3">
                <p className="text-sm text-muted-foreground">{t("source.excelHint")}</p>
                <div className="flex flex-wrap items-start gap-2">
                  <ExportButton endpoint={`/api/clients/${clientId}/structure/import/template`} label={t("source.template")} />
                  {draft ? (
                    <ExportButton endpoint={`/api/clients/${clientId}/structure/workbook?version=draft`} label={t("source.draftFile")} title={t("source.draftFileHint")} variant="ghost" />
                  ) : null}
                </div>
                <form onSubmit={upload} className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="import-xlsx">{t("source.excelFile")}</Label>
                    <Input id="import-xlsx" name="file" type="file" accept=".xlsx" required aria-invalid={!!error} />
                  </div>
                  {alert}
                  <Button type="submit" className="w-fit" disabled={busy}>
                    {busy ? <BrandLoader tone="current" className="size-4" /> : <Upload animateOnHover />}
                    {busy ? t("source.reading") : t("source.upload")}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="word" className="grid max-w-2xl gap-4 pt-3">
                <p className="text-sm text-muted-foreground">{t("source.wordHint")}</p>
                <form onSubmit={upload} className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="import-docx">{t("source.wordFile")}</Label>
                    <Input id="import-docx" name="file" type="file" accept=".docx" required aria-invalid={!!error} />
                  </div>
                  {alert}
                  <Button type="submit" className="w-fit" disabled={busy}>
                    {busy ? <BrandLoader tone="current" className="size-4" /> : <Upload animateOnHover />}
                    {busy ? t("source.reading") : t("source.upload")}
                  </Button>
                </form>
              </TabsContent>

              {assistant ? (
                <TabsContent value="text" className="grid max-w-2xl gap-4 pt-3">
                  <p className="text-sm text-muted-foreground">{t("source.textHint")}</p>
                  <form onSubmit={draftText} className="grid gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="import-text">{t("source.textLabel")}</Label>
                      <Textarea id="import-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} dir="auto" aria-invalid={!!error} />
                      <p className="text-xs text-muted-foreground tabular-nums">{t("source.textCount", { n: text.length, max: ORG_IMPORT_LIMITS.text })}</p>
                    </div>
                    {alert}
                    <Button type="submit" className="w-fit" disabled={busy || !text.trim()}>
                      {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                      {busy ? t("source.drafting") : t("source.draft")}
                    </Button>
                  </form>
                </TabsContent>
              ) : null}
            </Tabs>
          </CardContent>
        </Card>
      ) : null}

      {step === "review" && imported ? (
        <>
          <SectionHeader title={t("review.title")} description={t("review.hint")} />
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("review.from")}:</span>
            <bdi className="font-medium">{imported.fileName ?? t("review.fromText")}</bdi>
            <Badge variant="outline">{imported.source === "xlsx" ? "Excel" : imported.source === "docx" ? "Word" : t("source.text")}</Badge>
          </p>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label={t("review.units")} value={check.counts.units} />
            <StatTile label={t("review.positions")} value={check.counts.positions} />
            <StatTile label={t("review.needFix")} value={check.counts.withErrors} />
            {mode === "replace" ? (
              <StatTile
                label={t("review.removes")}
                value={check.counts.removeUnits + check.counts.removePositions}
                hint={t("review.removesHint", { units: check.counts.removeUnits, positions: check.counts.removePositions })}
              />
            ) : null}
          </div>

          {draft ? (
            <Card className="gap-3 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("review.modeTitle")}</CardTitle>
                <CardDescription>{t("review.modeQuestion", { units: draft.units, positions: draft.positions })}</CardDescription>
              </CardHeader>
              <CardContent className="px-5">
                <RadioGroup value={mode ?? ""} onValueChange={(v) => setMode(v as OrgImportMode)} className="gap-3 md:grid-cols-2" aria-label={t("review.modeTitle")}>
                  {(["replace", "add"] as const).map((m) => (
                    <label key={m} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                      <RadioGroupItem value={m} className="mt-0.5" />
                      <span className="space-y-0.5">
                        <span className="block font-medium">{t(`review.${m}`)}</span>
                        <span className="block text-muted-foreground">{t(`review.${m}Hint`)}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>
          ) : null}

          {imported.dropped.length ? (
            <Card className="gap-2 py-4 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-sm">{t("review.dropped")}</CardTitle>
                <CardDescription>{t("review.droppedHint")}</CardDescription>
              </CardHeader>
              <CardContent className="px-5">
                <ul className="flex flex-wrap gap-2 text-sm">
                  {imported.dropped.map((d, i) => (
                    <li key={i} className="rounded-md border px-2 py-1">
                      <span className="text-muted-foreground">{t(`drop.${d.kind}`)}: </span>
                      <bdi>{d.text}</bdi>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {leaving.positions.length + leaving.units.length ? (
            <Card className="gap-3 py-4 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-sm">{t("review.leavingTitle")}</CardTitle>
                <CardDescription>{t("review.leavingHint")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 px-5">
                <ul className="grid gap-1 text-sm">
                  {leaving.positions.map((p) => (
                    <li key={`p${p.code}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {p.code}
                      </span>
                      <bdi>{(locale === "ar" ? (p.titleAr ?? p.titleEn) : (p.titleEn ?? p.titleAr)) ?? ""}</bdi>
                      {p.holders.length ? (
                        <span className="text-xs text-foreground">{t("review.leavingHeld", { names: p.holders.join(locale === "ar" ? "، " : ", ") })}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("review.vacant")}</span>
                      )}
                    </li>
                  ))}
                  {leaving.units.map((u) => (
                    <li key={`u${u.code}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {u.code}
                      </span>
                      <bdi>{(locale === "ar" ? (u.nameAr ?? u.nameEn) : (u.nameEn ?? u.nameAr)) ?? ""}</bdi>
                      <span className="text-xs text-muted-foreground">{t("review.unit")}</span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={leavingSeen} onCheckedChange={(on) => setLeavingSeen(on === true)} className="mt-0.5" />
                  <span>{t("review.leavingConfirm")}</span>
                </label>
              </CardContent>
            </Card>
          ) : null}

          {rows.length ? (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="w-12">{t("review.line")}</TableHead>
                    <TableHead>{t("review.unit")}</TableHead>
                    <TableHead>{t("review.position")}</TableHead>
                    <TableHead>{t("review.reportsTo")}</TableHead>
                    <TableHead>{t("review.holder")}</TableHead>
                    <TableHead>{t("review.check")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <ReviewRow
                      key={r.line}
                      row={r}
                      check={byLine.get(r.line)}
                      issueText={issueText}
                      onInclude={(include) => setRows(rows.map((x) => (x.line === r.line ? { ...x, include } : x)))}
                      onEdit={() => setEditing(r)}
                      skipRemoves={skipEffect(r)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {errorText ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText}
            </p>
          ) : !mode ? (
            <p className="text-sm text-muted-foreground">{t("review.chooseMode")}</p>
          ) : mustSeeLeaving ? (
            <p className="text-sm text-muted-foreground">{t("review.leavingFirst")}</p>
          ) : check.counts.withErrors ? (
            <p className="text-sm text-destructive">{t("review.blocked", { n: check.counts.withErrors })}</p>
          ) : check.tooMany ? (
            <p className="text-sm text-destructive">{t("review.tooMany", { max: ORG_IMPORT_LIMITS.rows })}</p>
          ) : nothing ? (
            <p className="text-sm text-muted-foreground">{t("review.nothing")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStep("source");
                setImported(null);
                setError(null);
              }}
              disabled={busy}
            >
              {t("review.startAgain")}
            </Button>
            <Button onClick={save} disabled={blocked}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? t("review.saving") : t("review.save")}
            </Button>
          </div>
          {editing ? (
            <EditRow
              row={editing}
              onClose={() => setEditing(null)}
              onSave={(values) => {
                setRows(rows.map((x) => (x.line === editing.line ? { ...x, values, include: true, filled: x.filled.filter((f) => values[f] === x.values[f]), numbers: x.numbers?.filter((f) => values[f] === x.values[f]) } : x)));
                setEditing(null);
              }}
            />
          ) : null}
        </>
      ) : null}
      {confirmDialog}
    </>
  );
}

function ReviewRow(props: {
  row: OrgRow;
  check: OrgRowCheck | undefined;
  issueText: (i: OrgIssue) => string;
  onInclude: (on: boolean) => void;
  onEdit: () => void;
  /** Replacing: what skipping this row takes out of the draft. */
  skipRemoves: { positions: string[]; units: string[] } | null;
}) {
  const t = useTranslations("orgChartImport.review");
  const locale = useLocale();
  const { row, check } = props;
  const v = row.values;
  const local = (ar: string | undefined, en: string | undefined) => (locale === "ar" ? (ar ?? en) : (en ?? ar));
  const unitName = local(v.unitNameAr, v.unitNameEn);
  const title = local(v.titleAr, v.titleEn);
  const isPosition = !!(v.positionCode || v.titleAr || v.titleEn);
  const tone = !row.include ? "neutral" : check?.errors.length ? "problem" : check?.warnings.length ? "waiting" : "open";
  const label = !row.include ? t("leftOut") : check?.errors.length ? t("fix") : check?.warnings.length ? t("warn") : t("ready");
  return (
    <TableRow className={cn("align-top", !row.include && "text-muted-foreground")} data-line={row.line}>
      <TableCell>
        <Checkbox checked={row.include} onCheckedChange={(on) => props.onInclude(on === true)} aria-label={t("include", { n: row.line })} />
      </TableCell>
      <TableCell className="tabular-nums">{row.line}</TableCell>
      <TableCell className="max-w-64 whitespace-normal">
        {v.unitCode ? (
          <span className="me-1 font-mono text-xs text-muted-foreground" dir="ltr">
            {v.unitCode}
          </span>
        ) : null}
        {unitName ? (
          <span className="font-medium" dir="auto">
            {unitName}
          </span>
        ) : null}
        {parseYesNo(v.advisory) ? <span className="ms-1 text-xs text-muted-foreground">· {t("advisory")}</span> : null}
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal">
        {isPosition ? (
          <>
            {v.positionCode ? (
              <span className="me-1 font-mono text-xs text-muted-foreground" dir="ltr">
                {v.positionCode}
              </span>
            ) : null}
            <span dir="auto">{title ?? "—"}</span>
            {parseYesNo(v.head) ? <span className="ms-1 text-xs text-muted-foreground">· {t("head")}</span> : null}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{t("unitOnly")}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs" dir="ltr">
        {v.reportsTo ?? "—"}
      </TableCell>
      <TableCell className="max-w-48 whitespace-normal" dir="auto">
        {v.holder ?? (parseYesNo(v.vacant) ? t("vacant") : "—")}
      </TableCell>
      <TableCell className="min-w-56 whitespace-normal">
        <div className="space-y-1">
          <ToneBadge tone={tone}>{label}</ToneBadge>
          {row.include && check ? (
            <>
              {check.errors.map((i, k) => (
                <p key={`e${k}`} className="text-xs text-destructive">
                  {props.issueText(i)}
                </p>
              ))}
              {check.warnings.map((i, k) => (
                <p key={`w${k}`} className="text-xs text-foreground">
                  {props.issueText(i)}
                </p>
              ))}
              {check.notes.map((i, k) => (
                <p key={`n${k}`} className="text-xs text-muted-foreground">
                  {props.issueText(i)}
                </p>
              ))}
              {check.errors.length ? (
                <Button variant="ghost" size="sm" className="-ms-2 h-7" onClick={() => props.onInclude(false)}>
                  {props.skipRemoves && props.skipRemoves.positions.length + props.skipRemoves.units.length
                    ? t("skipRemoves", { codes: [...props.skipRemoves.units, ...props.skipRemoves.positions].join(locale === "ar" ? "، " : ", ") })
                    : t("skip")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Hint asChild tip={t("edit", { n: row.line })}>
          <Button variant="ghost" size="icon" className="size-7" onClick={props.onEdit} aria-label={t("edit", { n: row.line })}>
            <Pencil />
          </Button>
        </Hint>
      </TableCell>
    </TableRow>
  );
}

// Codes, levels and numbers read left to right in both languages.
const LTR: readonly OrgField[] = ["unitCode", "parentCode", "level", "positionCode", "reportsTo", "planned"];

/** Change what one row brings in: every column of the template, as text the checks read. */
function EditRow(props: { row: OrgRow; onClose: () => void; onSave: (values: OrgRow["values"]) => void }) {
  const t = useTranslations("orgChartImport.review");
  const tf = useTranslations("orgChartImport.fields");
  const tc = useTranslations("common");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values: OrgRow["values"] = {};
    for (const f of ORG_IMPORT_FIELDS) {
      const v = String(form.get(f) ?? "").trim();
      if (v) values[f] = v;
    }
    props.onSave(values);
  }
  return (
    <Dialog open onOpenChange={(o) => (!o ? props.onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("editTitle", { n: props.row.line })}</DialogTitle>
            <DialogDescription>{t("editHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {ORG_IMPORT_FIELDS.map((f) => (
              <div key={f} className={cn("grid gap-2", (f === "specialties" || f === "holder") && "sm:col-span-2")}>
                <Label htmlFor={`edit-${f}`}>{tf(f)}</Label>
                <Input id={`edit-${f}`} name={f} defaultValue={props.row.values[f] ?? ""} dir={LTR.includes(f) ? "ltr" : "auto"} placeholder={t("blank")} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit">{t("apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Upload } from "@/components/animate-ui/icons/upload";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  applyMapping,
  checkImport,
  findHeaderRow,
  IMPORT_FIELDS,
  leaveOutDuplicates,
  outlineMode,
  outlineRows,
  suggestMapping,
  type ImportContext,
  type ImportField,
  type ImportOptions,
  type ImportRow,
  type ImportSource,
  type Issue,
  type OutlineMode,
  type RowCheck,
} from "@/lib/plan-import";
import { cn } from "@/lib/utils";

// Importing a plan, in three steps on one page: the file (checked, scanned
// and read on the server), the columns (matched automatically, changeable),
// and the rows (checked as they are edited, by the same code the server runs
// again on confirm). Nothing is created until the person confirms.

interface Parsed {
  token: string;
  fileName: string;
  kind: "xlsx" | "docx";
  sources: ImportSource[];
}

type Step = "upload" | "map" | "review";
const SKIP = "skip";

/** An upload or import refusal as a "planImport.errors" key. */
function errorKey(status: number, message: string | undefined): string {
  const m = message ?? "";
  if (status === 503) return "scanner";
  if (m.includes("infected")) return "infected";
  if (m.includes("too large") || m.includes("too_large")) return "too_large";
  if (m.includes("rejected: empty")) return "empty";
  if (m.includes("rejected: unsafe")) return "unsafe";
  if (m.includes("rejected")) return "type";
  if (m.includes("nothing to import")) return "nothing";
  if (m.includes("expired")) return "expired";
  if (m.includes("rows with errors")) return "changed";
  return "generic";
}

function letters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** The source that most looks like a plan: the first whose columns name a recommendation, else the outline, else the first. */
function bestSource(sources: ImportSource[]): ImportSource {
  for (const s of sources) {
    if (s.kind === "outline") continue;
    const h = findHeaderRow(s.rows);
    if (suggestMapping(s.rows[h] ?? []).includes("recommendation")) return s;
  }
  return sources.find((s) => s.kind === "outline") ?? sources[0]!;
}

export function ImportWizard({ projectId, ctx }: { projectId: string; ctx: ImportContext }) {
  const t = useTranslations("planImport");
  const tf = useTranslations("importExport.fields");
  const tVis = useTranslations("visibility");
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();

  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [sourceId, setSourceId] = useState<string>("");
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [mode, setMode] = useState<OutlineMode>("findings");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [options, setOptions] = useState<ImportOptions>({ visibility: "shared", release: false });
  const [editing, setEditing] = useState<ImportRow | null>(null);

  const source = parsed?.sources.find((s) => s.id === sourceId) ?? null;

  function chooseSource(s: ImportSource) {
    setSourceId(s.id);
    setError(null);
    if (s.kind === "outline") setMode(outlineMode(s.blocks));
    else {
      const h = findHeaderRow(s.rows);
      setHeaderRow(h);
      setMapping(suggestMapping(s.rows[h] ?? []));
    }
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return setError("empty");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/import`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as Parsed & { message?: string };
      if (!res.ok) return setError(errorKey(res.status, body.message));
      setParsed(body);
      chooseSource(bestSource(body.sources));
      setStep("map");
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  function toReview() {
    if (!source) return;
    const next = source.kind === "outline" ? outlineRows(source.blocks, mode) : applyMapping(source.rows, headerRow, mapping);
    if (!next.length) return setError("noRows");
    setError(null);
    setRows(leaveOutDuplicates(next, ctx, options));
    setStep("review");
  }

  const check = useMemo(() => checkImport(rows, ctx, options), [rows, ctx, options]);
  const byLine = useMemo(() => new Map(check.rows.map((r) => [r.line, r])), [check]);
  const nothingNew = check.counts.findings + check.counts.recommendations + check.counts.actions === 0;

  async function runImport() {
    const c = check.counts;
    if (!(await confirm(t("review.confirm", { findings: c.findings, recommendations: c.recommendations, actions: c.actions })))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/import/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: parsed!.token, rows: rows.filter((r) => r.include).map((r) => ({ line: r.line, values: r.values })), options }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) return setError(errorKey(res.status, body.message));
      toast.success(t("review.done", { actions: c.actions }));
      router.push(`/projects/${projectId}`);
      router.refresh();
    } catch {
      setError("generic");
    } finally {
      setBusy(false);
    }
  }

  const issueText = (i: Issue) => t(`issues.${i.code}`, { field: i.field ? tf(i.field) : "", detail: i.detail ?? "" });
  const errorText = error ? (error === "noRows" ? t("map.noRows") : t(`errors.${error}`)) : null;

  return (
    <>
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("title")}>
        {(["upload", "map", "review"] as const).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            {i ? <span className="text-muted-foreground" aria-hidden>·</span> : null}
            <span aria-current={step === s ? "step" : undefined} className={cn(step === s ? "font-medium text-foreground" : "text-muted-foreground")}>
              {i + 1}. {t(`steps.${s}`)}
            </span>
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("upload.title")}</CardTitle>
              <CardDescription>{t("upload.hint")}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              <form onSubmit={upload} className="grid max-w-lg gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="import-file">{t("upload.file")}</Label>
                  <Input id="import-file" name="file" type="file" accept=".xlsx,.docx" required aria-invalid={!!error} />
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
            </CardContent>
          </Card>
          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("upload.whatTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5 text-sm text-muted-foreground">
              <p>{t("upload.excel")}</p>
              <p>{t("upload.wordTable")}</p>
              <p>{t("upload.wordOutline")}</p>
              <p className="text-xs">{t("upload.templateHint")}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {step === "map" && parsed && source ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("map.title")}</CardTitle>
            <CardDescription>{source.kind === "outline" ? t("map.outlineHint") : t("map.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 px-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("map.file")}:</span>
              <bdi className="font-medium">{parsed.fileName}</bdi>
              <Badge variant="outline">{parsed.kind === "xlsx" ? "Excel" : "Word"}</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setParsed(null);
                  setStep("upload");
                }}
              >
                {t("map.another")}
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {parsed.sources.length > 1 ? (
                <div className="grid gap-2">
                  <Label htmlFor="import-source">{t("map.source")}</Label>
                  <Select value={source.id} onValueChange={(id) => chooseSource(parsed.sources.find((s) => s.id === id)!)}>
                    <SelectTrigger id="import-source" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {parsed.sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.kind === "sheet" ? t("map.sheet", { name: s.name }) : s.kind === "table" ? t("map.table", { n: s.n }) : t("map.outline")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {source.kind === "outline" ? (
                <div className="grid gap-2">
                  <Label htmlFor="import-mode">{t("map.outlineMode")}</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as OutlineMode)}>
                    <SelectTrigger id="import-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="findings">{t("map.modeFindings")}</SelectItem>
                      <SelectItem value="recommendations">{t("map.modeRecommendations")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="import-header">{t("map.headerRow")}</Label>
                  <Select
                    value={String(headerRow)}
                    onValueChange={(v) => {
                      setHeaderRow(Number(v));
                      setMapping(suggestMapping(source.rows[Number(v)] ?? []));
                    }}
                  >
                    <SelectTrigger id="import-header" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {source.rows.slice(0, 15).map((r, i) =>
                        r.some((c) => c.trim()) ? (
                          <SelectItem key={i} value={String(i)}>
                            {t("map.row", { n: i + 1 })}: {r.filter(Boolean).slice(0, 3).join("، ").slice(0, 60)}
                          </SelectItem>
                        ) : null,
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {source.kind === "sheet" && source.truncated ? <p className="text-xs text-muted-foreground">{t("map.truncated")}</p> : null}

            {source.kind !== "outline" ? (
              <MappingTable rows={source.rows} headerRow={headerRow} mapping={mapping} onChange={setMapping} />
            ) : null}

            {errorText ? (
              <p role="alert" className="text-xs text-destructive">
                {errorText}
              </p>
            ) : null}
            {source.kind !== "outline" && !mapping.some((f) => f === "recommendation" || f === "finding") ? (
              <p role="alert" className="text-xs text-destructive">
                {t("map.needTitle")}
              </p>
            ) : null}
            <div>
              <Button onClick={toReview} disabled={source.kind !== "outline" && !mapping.some((f) => f === "recommendation" || f === "finding")}>
                {t("map.next")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "review" ? (
        <>
          <SectionHeader title={t("review.title")} description={t("review.hint")} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label={t("review.newFindings")} value={check.counts.findings} />
            <StatTile label={t("review.newRecommendations")} value={check.counts.recommendations} />
            <StatTile
              label={t("review.actions")}
              value={check.counts.actions}
              hint={check.counts.released ? t("review.released", { n: check.counts.released }) : t("review.drafts")}
            />
            <StatTile
              label={t("review.needFix")}
              value={check.counts.withErrors}
              hint={check.counts.withWarnings ? t("review.toCheck", { n: check.counts.withWarnings }) : undefined}
            />
          </div>

          <Card className="gap-4 py-5 shadow-xs">
            <CardContent className="grid gap-4 px-5 md:grid-cols-2">
              {ctx.client ? (
                <div className="grid gap-2">
                  <Label htmlFor="import-visibility">{t("review.visibility")}</Label>
                  <Select value={options.visibility} onValueChange={(v) => setOptions({ ...options, visibility: v as ImportOptions["visibility"] })}>
                    <SelectTrigger id="import-visibility" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shared">{tVis("shared")}</SelectItem>
                      <SelectItem value="firm_private">{tVis("firm_private")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {ctx.canRelease ? (
                <div className="flex items-start gap-3">
                  <span className="relative [&>input]:!start-0 [&>input]:![transform:none]">
                    <Switch id="import-release" checked={options.release} onCheckedChange={(on) => setOptions({ ...options, release: on })} />
                  </span>
                  <div className="grid gap-1">
                    <Label htmlFor="import-release" className="leading-snug">
                      {t("review.release")}
                    </Label>
                    <p className="text-xs text-muted-foreground">{t("review.releaseHint")}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead className="w-12">{t("review.line")}</TableHead>
                  <TableHead>{t("review.plan")}</TableHead>
                  <TableHead>{t("review.action")}</TableHead>
                  <TableHead>{t("review.owner")}</TableHead>
                  <TableHead>{t("review.due")}</TableHead>
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
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {errorText ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText}
            </p>
          ) : check.counts.withErrors ? (
            <p className="text-sm text-destructive">{t("review.blocked", { n: check.counts.withErrors })}</p>
          ) : check.tooMany ? (
            <p className="text-sm text-destructive">{t("review.tooMany")}</p>
          ) : nothingNew ? (
            <p className="text-sm text-muted-foreground">{t("review.nothing")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep("map")} disabled={busy}>
              {t("review.backToColumns")}
            </Button>
            <Button onClick={runImport} disabled={busy || check.counts.withErrors > 0 || check.tooMany || nothingNew}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? t("review.importing") : t("review.import")}
            </Button>
          </div>
          {editing ? (
            <EditRow
              row={editing}
              onClose={() => setEditing(null)}
              onSave={(values) => {
                setRows(rows.map((x) => (x.line === editing.line ? { ...x, values, filled: x.filled.filter((f) => values[f] === x.values[f]) } : x)));
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

/** One row per column of the file: its heading, an example value, and what it imports as. */
function MappingTable(props: {
  rows: string[][];
  headerRow: number;
  mapping: (ImportField | null)[];
  onChange: (m: (ImportField | null)[]) => void;
}) {
  const t = useTranslations("planImport.map");
  const tf = useTranslations("importExport.fields");
  const width = Math.max(0, ...props.rows.slice(props.headerRow, props.headerRow + 50).map((r) => r.length));
  const headers = props.rows[props.headerRow] ?? [];
  const sample = (c: number) =>
    props.rows
      .slice(props.headerRow + 1, props.headerRow + 20)
      .map((r) => r[c]?.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ");
  function set(c: number, value: string) {
    const field = value === SKIP ? null : (value as ImportField);
    // One column per field: picking a field moves it here.
    const next = Array.from({ length: width }, (_, i) => (i === c ? field : props.mapping[i] === field ? null : (props.mapping[i] ?? null)));
    props.onChange(next);
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("column")}</TableHead>
            <TableHead>{t("sample")}</TableHead>
            <TableHead className="w-64">{t("importAs")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: width }, (_, c) => (
            <TableRow key={c}>
              <TableCell className="font-medium" dir="auto">
                {headers[c]?.trim() || t("unnamed", { letter: letters(c) })}
              </TableCell>
              <TableCell className="max-w-xs truncate text-xs text-muted-foreground" dir="auto">
                {sample(c)}
              </TableCell>
              <TableCell>
                <Select value={props.mapping[c] ?? SKIP} onValueChange={(v) => set(c, v)}>
                  <SelectTrigger className="w-full" aria-label={`${t("importAs")}: ${headers[c]?.trim() || t("unnamed", { letter: letters(c) })}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP}>{t("skip")}</SelectItem>
                    {IMPORT_FIELDS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {tf(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReviewRow(props: { row: ImportRow; check: RowCheck | undefined; issueText: (i: Issue) => string; onInclude: (on: boolean) => void; onEdit: () => void }) {
  const t = useTranslations("planImport.review");
  const { row, check } = props;
  const v = row.values;
  const filled = (f: ImportField) => (row.filled.includes(f) ? <span className="text-xs text-muted-foreground"> ({t("sameAbove")})</span> : null);
  const tone = !row.include ? "neutral" : check?.errors.length ? "problem" : check?.warnings.length ? "waiting" : "open";
  const label = !row.include ? t("leftOut") : check?.errors.length ? t("fix") : check?.warnings.length ? t("warn") : t("ready");
  const creates = check
    ? [
        check.creates.finding ? t("createsFinding") : null,
        check.creates.recommendation ? t("createsRecommendation") : null,
        check.creates.action === "release" ? t("createsRelease") : check.creates.action === "draft" ? t("createsDraft") : null,
      ].filter(Boolean)
    : [];
  return (
    <TableRow className={cn("align-top", !row.include && "text-muted-foreground")} data-line={row.line}>
      <TableCell>
        <Checkbox checked={row.include} onCheckedChange={(on) => props.onInclude(on === true)} aria-label={t("include", { n: row.line })} />
      </TableCell>
      <TableCell className="tabular-nums">{row.line}</TableCell>
      <TableCell className="max-w-72 whitespace-normal">
        {v.finding ? (
          <p className="text-xs text-muted-foreground" dir="auto">
            {v.finding}
            {filled("finding")}
          </p>
        ) : null}
        {v.recommendation ? (
          <p className="font-medium" dir="auto">
            {v.recommendation}
            {filled("recommendation")}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="max-w-72 whitespace-normal" dir="auto">
        {v.action ?? "—"}
      </TableCell>
      <TableCell className="whitespace-normal" dir="auto">
        {v.owner ?? "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums" dir="auto">
        {v.dueDate ?? "—"}
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
              {check.notes
                .filter((i) => i.code !== "filled")
                .map((i, k) => (
                  <p key={`n${k}`} className="text-xs text-muted-foreground">
                    {props.issueText(i)}
                  </p>
                ))}
              {!check.errors.length ? <p className="text-xs text-muted-foreground">{creates.length ? creates.join(" · ") : t("createsNothing")}</p> : null}
            </>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" className="size-7" onClick={props.onEdit} aria-label={t("edit", { n: row.line })} title={t("edit", { n: row.line })}>
          <Pencil />
        </Button>
      </TableCell>
    </TableRow>
  );
}

const LONG: ImportField[] = ["findingDetails", "rationale", "targetOutcome", "requiredEvidence", "actionDetails", "evidence"];

/** Change what one row imports. Dates stay text here, because the file may hold Hijri or other forms the checks read. */
function EditRow(props: { row: ImportRow; onClose: () => void; onSave: (values: ImportRow["values"]) => void }) {
  const t = useTranslations("planImport.review");
  const tf = useTranslations("importExport.fields");
  const tc = useTranslations("common");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values: ImportRow["values"] = {};
    for (const f of IMPORT_FIELDS) {
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
            {IMPORT_FIELDS.map((f) => (
              <div key={f} className={cn("grid gap-2", LONG.includes(f) && "sm:col-span-2")}>
                <Label htmlFor={`edit-${f}`}>{tf(f)}</Label>
                {LONG.includes(f) ? (
                  <Textarea id={`edit-${f}`} name={f} rows={2} defaultValue={props.row.values[f] ?? ""} dir="auto" />
                ) : (
                  <Input id={`edit-${f}`} name={f} defaultValue={props.row.values[f] ?? ""} dir={f === "dueDate" || f === "recDueDate" ? "ltr" : "auto"} />
                )}
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

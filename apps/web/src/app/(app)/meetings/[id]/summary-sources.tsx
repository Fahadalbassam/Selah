"use client";

import { Link2, MessageSquareQuote } from "lucide-react";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { X } from "@/components/animate-ui/icons/x";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { openFilePage } from "../../projects/[id]/document-summary";

export interface SummarySource {
  id: string;
  line: number;
  kind: "transcript" | "document";
  documentId: string | null;
  documentTitle: string | null;
  page: number | null;
  excerpt: string | null;
  outdated: boolean;
}

/**
 * Where each line of the summary came from: a passage of the transcript
 * (firm only) or a page of a project file. Lines are numbered as saved.
 */
export function SummarySources(props: {
  meetingId: string;
  lines: string[];
  sources: SummarySource[];
  files: { id: string; title: string }[];
  canEdit: boolean;
  hasTranscript: boolean;
}) {
  const t = useTranslations("meeting.sources");
  const router = useRouter();
  const byLine = new Map<number, SummarySource[]>();
  for (const s of props.sources) byLine.set(s.line, [...(byLine.get(s.line) ?? []), s]);
  if (!props.sources.length && !props.canEdit) return null;

  async function remove(id: string) {
    const r = await callApi(`/api/meeting-summary-sources/${id}`, "DELETE");
    if (!r.ok) return toast.error(t("errors.generic"));
    router.refresh();
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t("title")}</p>
        {props.canEdit ? <AddSource {...props} /> : null}
      </div>
      {props.sources.length === 0 ? <p className="text-xs text-muted-foreground">{t("none")}</p> : null}
      <ul className="space-y-2">
        {[...byLine].map(([line, list]) => (
          <li key={line} className="grid gap-1">
            <span className="truncate text-xs text-muted-foreground">
              {t("line", { n: line })} · {props.lines[line - 1] ?? ""}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {list.map((s) => (
                <span key={s.id} className="inline-flex items-center rounded-md border text-xs">
                  {s.kind === "transcript" ? (
                    <Popover>
                      <PopoverTrigger className="inline-flex items-center gap-1 px-1.5 py-0.5 hover:bg-muted">
                        <MessageSquareQuote className="size-3" />
                        {t("transcript")}
                      </PopoverTrigger>
                      <PopoverContent className="max-w-sm text-sm whitespace-pre-wrap">
                        {s.excerpt ?? t("transcriptGone")}
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openFilePage(s.documentId!, s.page!)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 hover:bg-muted"
                      title={s.outdated ? t("outdated") : undefined}
                    >
                      <FileText className="size-3" />
                      {t("filePage", { title: s.documentTitle ?? "—", n: s.page! })}
                      {s.outdated ? <span className="text-muted-foreground">*</span> : null}
                    </button>
                  )}
                  {props.canEdit ? (
                    <button
                      type="button"
                      onClick={() => void remove(s.id)}
                      className="border-s px-1 py-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={t("remove")}
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {props.sources.some((s) => s.outdated) ? <p className="text-xs text-muted-foreground">* {t("outdated")}</p> : null}
    </div>
  );
}

function AddSource(props: {
  meetingId: string;
  lines: string[];
  files: { id: string; title: string }[];
  hasTranscript: boolean;
}) {
  const t = useTranslations("meeting.sources");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"transcript" | "document">(props.hasTranscript ? "transcript" : "document");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const line = Number(form.get("line"));
    const body =
      kind === "transcript"
        ? { kind, line, quote: String(form.get("quote") ?? "") }
        : { kind, line, documentId: String(form.get("documentId") ?? ""), page: Number(form.get("page")) };
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/meetings/${props.meetingId}/summary/sources`, "POST", body);
    setBusy(false);
    if (!r.ok) {
      const m = r.message ?? "";
      return setError(
        /not in the transcript/.test(m)
          ? "notInTranscript"
          : /no line/.test(m)
            ? "noLine"
            : /file in this project/.test(m)
              ? "file"
              : r.error === "invalid"
                ? "invalid"
                : "generic",
      );
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Link2 className="size-4" />
          {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{t("addHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="src-line">{t("whichLine")}</Label>
            <NativeSelect id="src-line" name="line" required className="w-full">
              {props.lines.map((l, i) =>
                l.trim() ? (
                  <NativeSelectOption key={i} value={i + 1}>
                    {i + 1}. {l.length > 80 ? `${l.slice(0, 80)}…` : l}
                  </NativeSelectOption>
                ) : null,
              )}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="src-kind">{t("kind")}</Label>
            <NativeSelect
              id="src-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as "transcript" | "document")}
              className="w-full"
            >
              {props.hasTranscript ? <NativeSelectOption value="transcript">{t("transcript")}</NativeSelectOption> : null}
              <NativeSelectOption value="document">{t("file")}</NativeSelectOption>
            </NativeSelect>
          </div>
          {kind === "transcript" ? (
            <div className="grid gap-2">
              <Label htmlFor="src-quote">{t("quote")}</Label>
              <Textarea id="src-quote" name="quote" required minLength={3} maxLength={5000} rows={4} />
              <p className="text-xs text-muted-foreground">{t("quoteHint")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <div className="grid gap-2">
                <Label htmlFor="src-file">{t("file")}</Label>
                <NativeSelect id="src-file" name="documentId" required className="w-full">
                  {props.files.map((f) => (
                    <NativeSelectOption key={f.id} value={f.id}>
                      {f.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="src-page">{t("page")}</Label>
                <Input id="src-page" name="page" type="number" min={1} required defaultValue={1} />
              </div>
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{t(`errors.${error}`)}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={busy || (kind === "document" && !props.files.length)}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Trash2 } from "lucide-react";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Upload } from "@/components/animate-ui/icons/upload";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatOf, parseTranscript, TRANSCRIPT_MAX_CHARS, type TranscriptFormat } from "@/lib/transcripts";
import { useConfirm } from "@/components/confirm-dialog";

interface Kept {
  lang: string;
  format: string;
  chars: number;
  importedAt: string;
  deleteAfter: string;
  importedBy: string | null;
}

/**
 * Firm staff only. Consent first (participants were told), then a transcript
 * file or pasted text once the meeting is held. It is kept for a limited
 * time and never shown to the client.
 */
export function TranscriptPanel(props: {
  meetingId: string;
  consent: boolean;
  held: boolean;
  spokenLang: "ar" | "en" | "mixed";
  transcript: Kept | null;
}) {
  const t = useTranslations("meeting.transcript");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<TranscriptFormat>("text");
  const [lang, setLang] = useState(props.spokenLang);
  const [body, setBody] = useState<string | null>(null);
  const endpoint = `/api/meetings/${props.meetingId}/transcript`;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return toast.error(tc(`errors.${r.error ?? "generic"}`));
    if (done) toast.success(done);
    router.refresh();
  }

  const [confirm, confirmDialog] = useConfirm();
  const setConsent = async (on: boolean) => {
    if (!on && props.transcript && !(await confirm(t("withdrawConfirm")))) return;
    return run(() => callApi(`/api/meetings/${props.meetingId}`, "PATCH", { transcriptConsent: on }));
  };

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > TRANSCRIPT_MAX_CHARS * 4) return toast.error(t("tooLong"));
    setFormat(formatOf(file.name));
    setText(await file.text());
  }

  const preview = text ? parseTranscript(text, format) : "";
  const tooLong = preview.length > TRANSCRIPT_MAX_CHARS;

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        <div className="flex items-start gap-3">
          <Switch id="consent" checked={props.consent} onCheckedChange={setConsent} disabled={busy} />
          <Label htmlFor="consent" className="leading-snug font-normal">
            {t("consent")}
          </Label>
        </div>

        {props.transcript ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <p className="flex flex-wrap items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              {t("kept", {
                who: props.transcript.importedBy ?? "—",
                date: props.transcript.importedAt,
                chars: props.transcript.chars,
              })}
            </p>
            <p className="text-xs text-muted-foreground">{t("deleteOn", { date: props.transcript.deleteAfter })}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (body !== null) return setBody(null);
                  const r = await callApi(endpoint, "GET");
                  if (r.ok) setBody((r.data as { body: string }).body);
                  else toast.error(tc("errors.generic"));
                }}
              >
                {body === null ? t("show") : t("hide")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => (await confirm(t("deleteConfirm"))) && run(() => callApi(endpoint, "DELETE"), t("deleted"))}
              >
                <Trash2 />
                {t("delete")}
              </Button>
            </div>
            {body !== null ? (
              <pre
                className="max-h-96 overflow-auto rounded-md bg-background p-3 font-sans text-sm whitespace-pre-wrap"
                dir="auto"
              >
                {body}
              </pre>
            ) : null}
          </div>
        ) : null}

        {!props.consent ? (
          <p className="text-muted-foreground">{t("needConsent")}</p>
        ) : !props.held ? (
          <p className="text-muted-foreground">{t("needHeld")}</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => callApi(endpoint, "PUT", { text, format, lang }), t("imported")).then(() => setText(""));
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-2">
                <Label htmlFor="transcript-file">{props.transcript ? t("replace") : t("file")}</Label>
                <input
                  id="transcript-file"
                  type="file"
                  accept=".txt,.vtt,.srt,text/plain,text/vtt"
                  onChange={(e) => void readFile(e.target.files?.[0])}
                  className="text-sm file:me-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="transcript-lang">{t("lang")}</Label>
                <NativeSelect id="transcript-lang" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
                  <NativeSelectOption value="ar">{t("langs.ar")}</NativeSelectOption>
                  <NativeSelectOption value="en">{t("langs.en")}</NativeSelectOption>
                  <NativeSelectOption value="mixed">{t("langs.mixed")}</NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transcript-text">{t("paste")}</Label>
              <Textarea
                id="transcript-text"
                rows={6}
                dir="auto"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFormat("text");
                }}
              />
            </div>
            {text ? (
              <p className={tooLong ? "text-destructive" : "text-xs text-muted-foreground"}>
                {tooLong ? t("tooLong") : t("preview", { chars: preview.length, format: t(`formats.${format}`) })}
              </p>
            ) : null}
            <Button type="submit" size="sm" disabled={busy || !preview || tooLong}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : <Upload />}
              {t("import")}
            </Button>
          </form>
        )}
      </CardContent>
      {confirmDialog}
    </Card>
  );
}

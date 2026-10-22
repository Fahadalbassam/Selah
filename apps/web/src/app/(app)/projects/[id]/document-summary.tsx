"use client";

import { Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Lang = "ar" | "en";
interface Point {
  text: string;
  pages: number[];
}
interface Loaded {
  aiIndexable: boolean;
  textStatus: "pending" | "searchable" | "not_searchable";
  summary: { points: Point[]; createdAt: string } | null;
}

/** Opens a cited page of a file: a fresh download link, at that page (PDF viewers honour #page). */
export async function openFilePage(documentId: string, page: number) {
  const r = await callApi(`/api/documents/${documentId}/download`, "GET");
  const url = r.ok ? (r.data as { url?: string } | null)?.url : null;
  if (url) window.open(`${url}#page=${page}`, "_blank", "noopener");
}

/**
 * A file's summary for firm staff: each line with the pages it rests on. The
 * kept summary is shown without asking the model; making one is a click.
 */
export function DocumentSummary({ documentId, title }: { documentId: string; title: string }) {
  const t = useTranslations("fileSummary");
  const [lang, setLang] = useState<Lang>(useLocale() === "en" ? "en" : "ar");
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(l: Lang) {
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/documents/${documentId}/summary?lang=${l}`, "GET");
    setBusy(false);
    if (r.ok) setData(r.data as Loaded);
    else setError("generic");
  }
  async function make() {
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/documents/${documentId}/summary`, "POST", { lang });
    setBusy(false);
    if (r.ok) setData((d) => d && { ...d, summary: r.data as Loaded["summary"] });
    else setError(errorKey(r.message));
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) void load(lang);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Sparkles className="size-4" />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={lang}
          onValueChange={(v) => {
            if (!v) return;
            setLang(v as Lang);
            void load(v as Lang);
          }}
          className="w-fit"
        >
          <ToggleGroupItem value="ar">العربية</ToggleGroupItem>
          <ToggleGroupItem value="en">English</ToggleGroupItem>
        </ToggleGroup>

        {busy ? <BrandLoader className="mx-auto size-6" /> : null}
        {!busy && data ? (
          data.summary ? (
            <ol className="space-y-3 text-sm" dir={lang === "ar" ? "rtl" : "ltr"}>
              {data.summary.points.map((p, i) => (
                <li key={i} className="flex flex-col gap-1.5">
                  <span>{p.text}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {p.pages.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => void openFilePage(documentId, n)}
                        className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
                      >
                        {t("page", { n })}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          ) : data.textStatus === "not_searchable" ? (
            <p className="text-sm text-muted-foreground">{t("notSearchable")}</p>
          ) : data.textStatus === "pending" ? (
            <p className="text-sm text-muted-foreground">{t("notIndexed")}</p>
          ) : !data.aiIndexable ? (
            <p className="text-sm text-muted-foreground">{t("notForAssistant")}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t("none")}</p>
              <Button size="sm" onClick={make}>
                <Sparkles className="size-4" />
                {t("make")}
              </Button>
            </div>
          )
        ) : null}
        {error ? <p className="text-sm text-destructive">{t(`errors.${error}`)}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function errorKey(message: string | undefined) {
  if (!message) return "generic";
  if (/too many summaries/.test(message)) return "limit";
  if (/not available right now|try again later|no summary that cites/.test(message)) return "unavailable";
  if (/no text|could not be read|not been indexed/.test(message)) return "noText";
  return "generic";
}

export function TextStatusBadge({ status }: { status: string }) {
  const t = useTranslations("fileSummary");
  if (status !== "not_searchable") return null;
  return (
    <Badge variant="outline" title={t("notSearchable")}>
      {t("notSearchableShort")}
    </Badge>
  );
}

"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { AiJobState, useAiJob } from "@/components/ai-job";
import { BrandLoader } from "@/components/brand";
import type { AiJob } from "@/lib/ai-jobs";
import { detectLang, type TranslatableType } from "@/lib/translations";
import { cn } from "@/lib/utils";

interface Shown {
  id: string | null;
  text: string;
  reviewed: boolean;
}

/**
 * Text people wrote, with "show in Arabic/English" when it is in the other
 * language. The translation is made once on request and kept; it carries a
 * "machine translated" label until firm staff mark it reviewed. The original
 * stays the record and is one click away.
 */
export function Translatable({
  entityType,
  entityId,
  field,
  text,
  canReview = false,
  className,
}: {
  entityType: TranslatableType;
  entityId: string;
  field: string;
  text: string;
  canReview?: boolean;
  className?: string;
}) {
  const t = useTranslations("translation");
  const locale = useLocale() as "ar" | "en";
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const aiJob = useAiJob();
  const source = detectLang(text);
  const other = source !== locale;

  const ask = () =>
    fetch("/api/translations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType, entityId, field, to: locale }),
    }).catch(() => null);

  async function load() {
    setBusy(true);
    aiJob.clear();
    try {
      let res = await ask();
      // A new translation is a job (docs/assistant.md, "Slow calls as jobs"): follow it, then ask again for the kept text.
      if (res?.status === 202) {
        const { job: filed } = (await res.json()) as { job: AiJob };
        const ended = await aiJob.follow(filed);
        if (ended.status !== "done") return;
        aiJob.clear();
        res = await ask();
      }
      if (!res?.ok) {
        const body = (await res?.json().catch(() => null)) as { message?: string } | null;
        return toast.error(t(res?.status === 429 ? "limited" : /already have requests/.test(body?.message ?? "") ? "busy" : "unavailable"));
      }
      const data = (await res.json()) as Shown & { original: boolean };
      setShown(data.original ? null : data);
    } catch {
      // The page moved on.
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    if (!shown?.id) return;
    setBusy(true);
    const res = await fetch(`/api/translations/${shown.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast.error(t("unavailable"));
    setShown({ ...shown, reviewed: true });
  }

  const link =
    "inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50";

  return (
    <div className={cn("space-y-1", className)}>
      <p className="whitespace-pre-wrap" dir={shown ? "auto" : source === "ar" ? "rtl" : "ltr"} lang={shown ? locale : source}>
        {shown ? shown.text : text}
      </p>
      {other ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {shown ? (
            <>
              <span className="text-xs text-muted-foreground">{shown.reviewed ? t("reviewed") : t("machine")}</span>
              <button type="button" className={link} onClick={() => setShown(null)}>
                {t("original")}
              </button>
              {canReview && !shown.reviewed ? (
                <button type="button" className={link} onClick={review} disabled={busy}>
                  {t("markReviewed")}
                </button>
              ) : null}
            </>
          ) : aiJob.job ? (
            <AiJobState job={aiJob.job} waitedMs={aiJob.waitedMs} onCancel={() => void aiJob.cancel()} className="text-xs" />
          ) : (
            <button type="button" className={link} onClick={load} disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-3" /> : <Languages className="size-3" />}
              {t("show")}
            </button>
          )}
          {/* A job that ended without a translation: say why, and the link is there to ask again. */}
          {aiJob.job && aiJob.job.status !== "done" && !busy ? (
            <button type="button" className={link} onClick={load}>
              <Languages className="size-3" />
              {t("show")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

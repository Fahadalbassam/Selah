"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
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
  const source = detectLang(text);
  const other = source !== locale;

  async function load() {
    setBusy(true);
    const res = await fetch("/api/translations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType, entityId, field, to: locale }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast.error(t(res?.status === 429 ? "limited" : "unavailable"));
    const data = (await res.json()) as Shown & { original: boolean };
    setShown(data.original ? null : data);
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
          ) : (
            <button type="button" className={link} onClick={load} disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-3" /> : <Languages className="size-3" />}
              {t("show")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

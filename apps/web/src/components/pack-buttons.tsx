"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download } from "@/components/animate-ui/icons/download";
import { Package } from "lucide-react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";

/** Makes an export pack in the reader's language, then shows it in the list. */
export function MakePackButton({ endpoint }: { endpoint: string }) {
  const t = useTranslations("offboarding.pack");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: locale }) });
      if (!res.ok) return setError(res.status === 429 ? t("tooMany") : t("failed"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5">
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        {busy ? <BrandLoader className="size-4" /> : <Package />}
        {busy ? t("making") : t("make")}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Asks the server for a one-minute link to the pack (checked and audited), then follows it. */
export function PackDownloadButton({ endpoint }: { endpoint: string }) {
  const t = useTranslations("offboarding.pack");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function run() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(endpoint);
      if (res.ok) window.location.assign(((await res.json()) as { url: string }).url);
      else setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="ghost" className="h-7" onClick={run} disabled={busy}>
        <Download className="size-3.5" />
        {t("download")}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {t("downloadFailed")}
        </span>
      ) : null}
    </>
  );
}

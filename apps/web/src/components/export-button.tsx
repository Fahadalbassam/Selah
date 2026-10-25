"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Download } from "@/components/animate-ui/icons/download";
import { MotionGrid, MotionGridCells, type Frames } from "@animate-ui/react/primitives/motion-grid";
import { Button } from "@/components/ui/button";

/** The file name the server chose (the readable title when it sent one). */
function fileName(disposition: string | null, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "")?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]+)"/i.exec(disposition ?? "")?.[1] ?? fallback;
}

// A ripple through a 3x3 grid while the file is made: the centre, the edges, the corners.
const FRAMES: Frames = [
  [[1, 1]],
  [[0, 1], [1, 0], [1, 2], [2, 1]],
  [[0, 0], [0, 2], [2, 0], [2, 2]],
  [],
];

/** The busy mark of an export (Animate UI Motion Grid), in the button's own colour. */
function Preparing() {
  return (
    <MotionGrid gridSize={[3, 3]} frames={FRAMES} duration={140} className="size-4 gap-0.5" aria-hidden>
      <MotionGridCells className="size-1 rounded-full bg-current opacity-25 data-[active=true]:opacity-100" />
    </MotionGrid>
  );
}

/**
 * Downloads an export (Excel or PDF) from one of our GET routes, in the
 * reader's language. The server decides what the file holds; this only
 * fetches it, saves it, and says so inline when it could not be made.
 */
export function ExportButton({ endpoint, label, title, variant = "outline" }: { endpoint: string; label: string; title?: string; variant?: "outline" | "ghost" }) {
  const t = useTranslations("exports");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}lang=${locale}`);
      if (!res.ok) return setError(res.status === 503 ? t("unavailable") : res.status === 429 ? t("tooMany") : t("failed"));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(res.headers.get("content-disposition"), "selah-export");
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} size="sm" onClick={run} disabled={busy} title={title}>
        {busy ? <Preparing /> : <Download />}
        {busy ? t("preparing") : label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

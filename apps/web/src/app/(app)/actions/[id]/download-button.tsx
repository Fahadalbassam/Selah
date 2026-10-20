"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Asks the server for a one-minute link (checked and audited), then follows it. */
export function DownloadButton({ documentId, label }: { documentId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/download`);
      if (res.ok) window.location.assign(((await res.json()) as { url: string }).url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="ghost" size="sm" className="ms-auto h-7" onClick={download} disabled={busy}>
      <Download className="size-3.5" />
      {label}
    </Button>
  );
}

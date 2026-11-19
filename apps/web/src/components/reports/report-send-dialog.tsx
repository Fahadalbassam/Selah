"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

/** What GET /api/reports/:id/share answers (sendPreview in services/report-send.ts). */
export interface SendPreview {
  id: string;
  title: string;
  kind: string;
  projectId: string;
  client: { en: string; ar: string } | null;
  issued: boolean;
  approval: { at: string | null; by: string | null } | null;
  sentAt: string | null;
  approver: "lead_or_deputy" | "internal_lead";
  can: { send: boolean; approve: boolean };
}

/** Where the dialog finds its report: the report page names it; the assistant names its draft answer. */
export type SendSource = { reportId: string } | { messageId: string };

/** The URL the dialog reads first. Reading never sends anything. */
export function previewUrl(source: SendSource) {
  return "reportId" in source ? `/api/reports/${source.reportId}/share` : `/api/assistant/messages/${source.messageId}/report`;
}

/** What the dialog says, in order: sent, not issued, waiting for approval, ready (or not this person's to send). */
export function sendState(p: SendPreview | null): "none" | "sent" | "notIssued" | "waiting" | "ready" | "cantSend" {
  if (!p) return "none";
  if (p.sentAt) return "sent";
  if (!p.issued) return "notIssued";
  if (!p.approval?.at) return "waiting";
  return p.can.send ? "ready" : "cantSend";
}

/**
 * The one confirmation dialog that sends a report to the client, opened from
 * the report page or from under a progress draft in the assistant. Opening it
 * only reads; the report goes only when the person presses Send here, and
 * only once a colleague approved it (the server checks both, migration 0110).
 */
export function ReportSendDialog({ source, trigger }: { source: SendSource; trigger: ReactNode }) {
  const t = useTranslations("reportSend");
  const tc = useTranslations("common");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });

  async function load() {
    setLoading(true);
    setError(null);
    const r = await callApi(previewUrl(source), "GET");
    setLoading(false);
    if (!r.ok) return setError(r.error);
    const data = r.data as SendPreview | { report: SendPreview | null };
    setPreview("report" in data ? data.report : data);
  }

  async function send() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/reports/${preview.id}/share`, "POST", { confirmed: true });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    toast.success(t("sent"));
    router.refresh();
  }

  const state = sendState(preview);
  const client = preview?.client ? (locale === "ar" ? preview.client.ar : preview.client.en) : "";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sendTitle")}</DialogTitle>
          {preview ? (
            <DialogDescription dir="auto" className="font-medium text-foreground">
              {preview.title}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {loading ? (
          <BrandLoader className="mx-auto size-6" />
        ) : (
          <div className="grid gap-2 text-sm">
            {state === "none" && !error ? (
              <>
                <p>{t("noReport")}</p>
                {"messageId" in source ? (
                  <Button asChild variant="outline" size="sm" className="w-fit">
                    <Link href={`/assistant/draft/${source.messageId}`}>{t("useDraft")}</Link>
                  </Button>
                ) : null}
              </>
            ) : null}
            {state === "sent" ? <p>{t("sentOn", { date: day(preview!.sentAt!) })}</p> : null}
            {state === "notIssued" ? <p>{t("notIssued")}</p> : null}
            {state === "waiting" ? (
              <>
                <p className="font-medium">{t("waiting")}</p>
                <p className="text-muted-foreground">{t(preview!.approver === "internal_lead" ? "waitingHintInternal" : "waitingHint")}</p>
              </>
            ) : null}
            {state === "ready" || state === "cantSend" ? (
              <>
                <p className="text-muted-foreground">
                  {preview!.approval!.by ? t("approvedBy", { who: preview!.approval!.by, date: day(preview!.approval!.at!) }) : t("approvedBefore")}
                </p>
                <p>{state === "ready" ? t("who", { client }) : t("cantSend")}</p>
              </>
            ) : null}
            {error ? <p className="text-destructive">{tc(`errors.${error}`)}</p> : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          {state === "ready" ? (
            <Button type="button" onClick={send} disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : <Send />}
              {t("confirm")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

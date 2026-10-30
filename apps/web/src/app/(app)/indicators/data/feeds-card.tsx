"use client";

import { KeyRound, PlugZap, RefreshCw, Sheet, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { callApi } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

export interface FeedRow {
  id: string;
  kind: "sheet" | "api";
  label: string;
  url: string | null;
  tokenHint: string | null;
  runAs: string;
  createdAt: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastAdded: number | null;
  failures: number;
}

type Preview =
  | { ok: true; layout: string; values: number; labels: { label: string; kpiId: string | null }[] }
  | { ok: false; reason: string };

/**
 * The client's connections: a published Google Sheet Selah reads once a day,
 * or a key its own systems send figures with (shown once). Only the client's
 * admin connects or disconnects; the firm sees how they run.
 */
export function FeedsCard({
  clientId,
  feeds,
  canConnect,
  endpoint,
  extraHosts,
}: {
  clientId: string;
  feeds: FeedRow[];
  canConnect: boolean;
  endpoint: string;
  extraHosts: string[];
}) {
  const t = useTranslations("indicatorData.feeds");
  const format = useFormatter();
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [adding, setAdding] = useState<"sheet" | "api" | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  function close() {
    setAdding(null);
    setPreview(null);
    setUrl("");
    setLabel("");
  }

  async function check() {
    setBusy(true);
    const r = await callApi(`/api/clients/${clientId}/indicator-data/preview`, "POST", { url });
    setBusy(false);
    setPreview(r.ok ? (r.data as Preview) : { ok: false, reason: "unreachable" });
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await callApi(`/api/clients/${clientId}/indicator-data/feeds`, "POST", adding === "sheet" ? { kind: "sheet", label, url } : { kind: "api", label });
    setBusy(false);
    if (!r.ok) return void toast.error(r.message?.includes("sheet link") ? t("errors.host") : r.message?.includes("five") ? t("errors.five") : t("errors.generic"));
    if (adding === "api") setKey((r.data as { token: string }).token);
    toast.success(t("connected"));
    close();
    router.refresh();
  }

  async function disconnect(id: string) {
    if (!(await confirm(t("disconnectConfirm")))) return;
    const r = await callApi(`/api/indicator-feeds/${id}`, "DELETE");
    if (!r.ok) return void toast.error(t("errors.generic"));
    toast.success(t("disconnected"));
    router.refresh();
  }

  async function readNow(id: string) {
    setBusy(true);
    const r = await callApi(`/api/indicator-feeds/${id}/read`, "POST");
    setBusy(false);
    if (!r.ok) return void toast.error(r.message?.includes("only the person") ? t("errors.notYours") : t("errors.generic"));
    const d = r.data as { ok: boolean; reason?: string; add?: number; correct?: number };
    if (!d.ok) toast.error(t(`reasons.${d.reason ?? "unreachable"}`));
    else toast.success(t("readDone", { n: (d.add ?? 0) + (d.correct ?? 0) }));
    router.refresh();
  }

  const example = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer <key>" \\
  -H "Content-Type: application/json" \\
  -d '{"values":[{"indicator":"complaints","period":"2026-10","value":31,"note":"from the CRM"}]}'`;

  return (
    <Card className="gap-4 py-5 shadow-xs">
      {confirmDialog}
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlugZap className="size-4 text-muted-foreground" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("hint")}</CardDescription>
        </div>
        {canConnect ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdding("sheet")}>
              <Sheet />
              {t("addSheet")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding("api")}>
              <KeyRound />
              {t("addKey")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {feeds.length ? (
          <ul className="divide-y">
            {feeds.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex items-center gap-2 font-medium" dir="auto">
                    {f.kind === "sheet" ? <Sheet className="size-4 text-muted-foreground" /> : <KeyRound className="size-4 text-muted-foreground" />}
                    {f.label}
                    <Badge variant="outline">{t(`kinds.${f.kind}`)}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.kind === "api" ? t("keyEnds", { hint: f.tokenHint ?? "" }) : t("dailyRead")} · {t("connectedBy", { name: f.runAs, when: when(f.createdAt) })}
                  </p>
                </div>
                <div className="text-xs">
                  {f.failures > 0 ? (
                    <ToneBadge tone="problem">{t("failing", { reason: t(`reasons.${f.lastError ?? "unreachable"}`) })}</ToneBadge>
                  ) : f.lastOkAt ? (
                    <span className="text-muted-foreground">{t("lastOk", { when: when(f.lastOkAt), n: f.lastAdded ?? 0 })}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("notYet")}</span>
                  )}
                </div>
                {canConnect ? (
                  <div className="flex gap-1">
                    {f.kind === "sheet" ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void readNow(f.id)}>
                        <RefreshCw />
                        {t("readNow")}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => void disconnect(f.id)}>
                      <Unplug />
                      {t("disconnect")}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{canConnect ? t("emptyAdmin") : t("empty")}</p>
        )}
        <details className="rounded-lg border bg-surface px-4 py-3 text-sm text-surface-foreground">
          <summary className="cursor-pointer font-medium">{t("howTitle")}</summary>
          <div className="mt-3 space-y-3 text-muted-foreground">
            <p>{t("howSheet")}</p>
            <p>{t("howKey")}</p>
            <div className="relative">
              <pre dir="ltr" className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
                {example}
              </pre>
              <CopyButton content={example} label={t("copy")} className="absolute end-1 top-1" />
            </div>
            <p>{t("howAnswer")}</p>
          </div>
        </details>
      </CardContent>

      <Dialog open={adding !== null} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={add} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{adding === "sheet" ? t("addSheet") : t("addKey")}</DialogTitle>
              <DialogDescription>{adding === "sheet" ? t("sheetHint", { hosts: extraHosts.join(", ") || "—" }) : t("keyHint")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="feed-label">{t("label")}</Label>
              <Input id="feed-label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} dir="auto" placeholder={t("labelPlaceholder")} />
            </div>
            {adding === "sheet" ? (
              <div className="grid gap-2">
                <Label htmlFor="feed-url">{t("url")}</Label>
                <div className="flex gap-2">
                  <Input id="feed-url" value={url} onChange={(e) => (setUrl(e.target.value), setPreview(null))} required dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" />
                  <Button type="button" variant="outline" disabled={busy || !url} onClick={() => void check()}>
                    {t("check")}
                  </Button>
                </div>
                {preview ? (
                  preview.ok ? (
                    <div className="space-y-1 rounded-md bg-muted px-3 py-2 text-xs">
                      <p>{t("previewOk", { n: preview.values, layout: t(`layouts.${preview.layout}`) })}</p>
                      <ul className="flex flex-wrap gap-1">
                        {preview.labels.map((l) => (
                          <li key={l.label}>
                            <Badge variant={l.kpiId ? "secondary" : "outline"} dir="auto">
                              {l.label} {l.kpiId ? "✓" : "?"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                      <p className="text-muted-foreground">{t("previewHint")}</p>
                    </div>
                  ) : (
                    <p role="alert" className="text-xs text-destructive">
                      {t(`reasons.${preview.reason}`)}
                    </p>
                  )
                ) : null}
                <p className="text-xs text-muted-foreground">{t("sheetPrivacy")}</p>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={busy || !label.trim() || (adding === "sheet" && !(preview && preview.ok))}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {t("connect")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={key !== null} onOpenChange={(o) => (o ? null : setKey(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("keyTitle")}</DialogTitle>
            <DialogDescription>{t("keyOnce")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md bg-muted p-3">
            <code dir="ltr" className="min-w-0 flex-1 break-all text-xs">
              {key}
            </code>
            <CopyButton content={key ?? ""} label={t("copy")} />
          </div>
          <DialogFooter>
            <Button onClick={() => setKey(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

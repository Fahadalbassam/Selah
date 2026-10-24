"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CLIENT_AI_LIMIT, CLIENT_AI_ROLES, type ClientAiRole } from "@/lib/client-ai";

export interface ClientAiView {
  enabled: boolean;
  roles: ClientAiRole[];
  dailyLimit: number;
  eligible: boolean;
  canManage: boolean;
  consent: { givenBy: string | null; givenAt: Date | string } | null;
  history: { id: string; version: string; givenBy: string | null; givenAt: Date | string; endedBy: string | null; endedAt: Date | string | null }[];
}

/**
 * The client assistant (wave 3, F39), on the client page. Off until the firm
 * admin offers it here and the client's admin consents on their side; the
 * consultants read the state. Switching it off, or offering it to a new role,
 * ends the consent, so the client's admin agrees again.
 */
export function ClientAiCard({ clientId, view }: { clientId: string; view: ClientAiView }) {
  const t = useTranslations("clientAi");
  const tRole = useTranslations("role");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const status = !view.enabled ? "off" : view.consent ? "on" : "waiting";

  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("hint")}</CardDescription>
        </div>
        {view.canManage ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Pencil />
            {t("change")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ToneBadge tone={status === "on" ? "active" : status === "waiting" ? "waiting" : "neutral"}>{t(`status.${status}`)}</ToneBadge>
          </div>
          <p className="text-muted-foreground">
            {!view.eligible
              ? t("notEligible")
              : status === "on" && view.consent
                ? t("onHint", { name: view.consent.givenBy ?? "", date: day(view.consent.givenAt) })
                : t(`${status}Hint`)}
          </p>
        </div>
        {view.enabled ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t pt-4">
            <dt className="text-muted-foreground">{t("roles")}</dt>
            <dd>{format.list(view.roles.map((r) => tRole(r)), { type: "conjunction" })}</dd>
            <dt className="text-muted-foreground">{t("limit")}</dt>
            <dd>{t("perDay", { n: view.dailyLimit })}</dd>
          </dl>
        ) : null}
        {view.history.length ? (
          <div className="space-y-1.5 border-t pt-4">
            <p className="font-medium">{t("history")}</p>
            <ul className="space-y-1 text-muted-foreground">
              {view.history.map((c) => (
                <li key={c.id}>
                  {t("given", { name: c.givenBy ?? "", date: day(c.givenAt) })}
                  {c.endedAt ? ` · ${t("ended", { name: c.endedBy ?? "", date: day(c.endedAt) })}` : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
      {view.canManage ? <SettingsDialog open={open} onOpenChange={setOpen} clientId={clientId} view={view} /> : null}
    </Card>
  );
}

function SettingsDialog({ open, onOpenChange, clientId, view }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string; view: ClientAiView }) {
  const t = useTranslations("clientAi");
  const tc = useTranslations("common");
  const tRole = useTranslations("role");
  const router = useRouter();
  const [enabled, setEnabled] = useState(view.enabled);
  const [roles, setRoles] = useState<ClientAiRole[]>(view.roles);
  const [limit, setLimit] = useState(String(view.dailyLimit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(limit);
  const limitOk = Number.isInteger(n) && n >= CLIENT_AI_LIMIT.min && n <= CLIENT_AI_LIMIT.max;
  // Offering it to someone new, or switching it off, ends the consent in force.
  const endsConsent = view.consent !== null && (!enabled || roles.some((r) => !view.roles.includes(r)));

  function reset() {
    setEnabled(view.enabled);
    setRoles(view.roles);
    setLimit(String(view.dailyLimit));
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/clients/${clientId}/assistant`, "PUT", { enabled, roles, dailyLimit: n });
    setBusy(false);
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    onOpenChange(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogHint")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
            <span className="space-y-0.5">
              <span className="block font-medium">{t("offer")}</span>
              <span className="block text-muted-foreground">{t("offerHint")}</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
          <fieldset className="grid gap-2" disabled={!enabled}>
            <legend className="mb-1 text-sm font-medium">{t("roles")}</legend>
            {CLIENT_AI_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={roles.includes(r)}
                  onCheckedChange={(c) => setRoles((cur) => (c ? [...cur.filter((x) => x !== r), r] : cur.filter((x) => x !== r)))}
                />
                {tRole(r)}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t("ownersOut")}</p>
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="client-ai-limit">{t("limit")}</Label>
            <Input
              id="client-ai-limit"
              type="number"
              inputMode="numeric"
              min={CLIENT_AI_LIMIT.min}
              max={CLIENT_AI_LIMIT.max}
              value={limit}
              disabled={!enabled}
              onChange={(e) => setLimit(e.target.value)}
              className="w-28"
            />
            <p className="text-xs text-muted-foreground">{t("limitHint", { min: CLIENT_AI_LIMIT.min, max: CLIENT_AI_LIMIT.max })}</p>
          </div>
          {endsConsent ? <p className="text-sm text-muted-foreground">{t("endsConsent")}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || (enabled && (!roles.length || !limitOk))}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

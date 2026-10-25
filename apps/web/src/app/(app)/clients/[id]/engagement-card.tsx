"use client";

import { Pencil, Network } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ENGAGEMENT_MODES, engagementError } from "@/lib/engagement";
import { cn } from "@/lib/utils";

type Mode = (typeof ENGAGEMENT_MODES)[number];

export interface EngagementSummary {
  id: string;
  engagementMode: Mode | null;
  departmentsEnabled: boolean;
  minimalRecords: boolean;
  displayAlias: string | null;
  departmentCount: number;
  canChangeMode: boolean;
  fit: { activeAccounts: number; nonAdminAccounts: number; restrictedMaxAdmins: number; hasContactsOrFiles: boolean } | null;
}

/** How the client takes part, on the client page. The firm admin changes it here. */
export function EngagementCard({ data }: { data: EngagementSummary }) {
  const t = useTranslations("engagement");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [modeOpen, setModeOpen] = useState(false);
  const [minimalOpen, setMinimalOpen] = useState(false);
  const mode = data.engagementMode ?? "full";

  async function minimalOff() {
    if (!(await confirm(t("minimal.offConfirm")))) return;
    const r = await callApi(`/api/orgs/${data.id}/engagement`, "PATCH", { minimalRecords: false });
    if (!r.ok)
      return toast.error(
        t.has(`errors.${engagementError(r.message)}`) ? t(`errors.${engagementError(r.message)}`) : tc(`errors.${r.error}`),
      );
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("hint")}</CardDescription>
        </div>
        {data.canChangeMode ? (
          <Button size="sm" variant="outline" onClick={() => setModeOpen(true)}>
            <Pencil />
            {t("change")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        <div className="space-y-1">
          <p className="font-medium">{t(`modes.${mode}.label`)}</p>
          <p className="text-muted-foreground">{t(`modes.${mode}.hint`)}</p>
        </div>
        {mode === "consultant_managed" ? (
          <div className="space-y-2 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t("minimal.title")}</span>
              <ToneBadge tone={data.minimalRecords ? "active" : "neutral"}>{data.minimalRecords ? t("on") : t("off")}</ToneBadge>
            </div>
            <p className="text-muted-foreground">
              {data.minimalRecords ? t("minimal.onHint", { alias: data.displayAlias ?? "" }) : t("minimal.offHint")}
            </p>
            {data.canChangeMode ? (
              data.minimalRecords ? (
                <Button size="sm" variant="ghost" onClick={minimalOff}>
                  {t("minimal.switchOff")}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setMinimalOpen(true)} disabled={data.fit?.hasContactsOrFiles}>
                  {t("minimal.switchOn")}
                </Button>
              )
            ) : null}
            {data.canChangeMode && !data.minimalRecords && data.fit?.hasContactsOrFiles ? (
              <p className="text-xs text-muted-foreground">{t("minimal.blocked")}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t("departments.title")}</span>
              <ToneBadge tone={data.departmentsEnabled ? "active" : "neutral"}>
                {data.departmentsEnabled ? t("on") : t("off")}
              </ToneBadge>
            </div>
            <p className="text-muted-foreground">{t("departments.count", { n: data.departmentCount })}</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/clients/${data.id}/departments`}>
              <Network />
              {t("departments.open")}
            </Link>
          </Button>
        </div>
      </CardContent>
      {data.canChangeMode ? (
        <>
          <ModeDialog open={modeOpen} onOpenChange={setModeOpen} data={data} />
          <MinimalDialog open={minimalOpen} onOpenChange={setMinimalOpen} clientId={data.id} />
        </>
      ) : null}
      {confirmDialog}
    </Card>
  );
}

function ModeDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data: EngagementSummary;
}) {
  const t = useTranslations("engagement");
  const tc = useTranslations("common");
  const router = useRouter();
  const current = data.engagementMode ?? "full";
  const [mode, setMode] = useState<Mode>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fit = data.fit;

  // Why a mode cannot be chosen yet; the database checks again on save.
  function blocker(m: Mode): string | null {
    if (m === current || !fit) return null;
    if (data.minimalRecords) return t("blockers.minimal");
    if (m === "consultant_managed" && fit.activeAccounts > 0) return t("blockers.accounts", { n: fit.activeAccounts });
    if (m === "restricted" && fit.nonAdminAccounts > 0) return t("blockers.nonAdmins", { n: fit.nonAdminAccounts });
    if (m === "restricted" && fit.activeAccounts > fit.restrictedMaxAdmins)
      return t("blockers.tooMany", { n: fit.restrictedMaxAdmins });
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === current) return onOpenChange(false);
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/orgs/${data.id}/engagement`, "PATCH", { engagementMode: mode });
    setBusy(false);
    if (!r.ok) {
      const key = engagementError(r.message);
      return setError(key && t.has(`errors.${key}`) ? t(`errors.${key}`) : tc(`errors.${r.error}`));
    }
    onOpenChange(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  const blocked = ENGAGEMENT_MODES.some((m) => blocker(m));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        setMode(current);
        setError(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("changeTitle")}</DialogTitle>
            <DialogDescription>{t("changeHint")}</DialogDescription>
          </DialogHeader>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-3" aria-label={t("title")}>
            {ENGAGEMENT_MODES.map((m) => {
              const why = blocker(m);
              return (
                <label key={m} className={cn("flex items-start gap-3 rounded-lg border p-3 text-sm", why && "opacity-60")}>
                  <RadioGroupItem value={m} disabled={!!why} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block font-medium">
                      {t(`modes.${m}.label`)}
                      {m === current ? (
                        <span className="ms-2 text-xs font-normal text-muted-foreground">{t("current")}</span>
                      ) : null}
                    </span>
                    <span className="block text-muted-foreground">{why ?? t(`modes.${m}.hint`)}</span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
          {blocked ? (
            <p className="text-xs text-muted-foreground">
              {t.rich("blockers.where", {
                link: (chunks) => (
                  <Link href={`/clients/${data.id}/people`} className="text-foreground underline underline-offset-4">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("nothingDeleted")}</p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || mode === current}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MinimalDialog({
  open,
  onOpenChange,
  clientId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
}) {
  const t = useTranslations("engagement");
  const tc = useTranslations("common");
  const router = useRouter();
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/orgs/${clientId}/engagement`, "PATCH", { minimalRecords: true, displayAlias: alias });
    setBusy(false);
    if (!r.ok) {
      const key = engagementError(r.message);
      return setError(key && t.has(`errors.${key}`) ? t(`errors.${key}`) : tc(`errors.${r.error}`));
    }
    onOpenChange(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        setError(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("minimal.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("minimal.dialogHint")}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t("minimal.effects.name")}</li>
            <li>{t("minimal.effects.inquiry")}</li>
            <li>{t("minimal.effects.files")}</li>
            <li>{t("minimal.effects.purge")}</li>
          </ul>
          <div className="grid gap-2">
            <Label htmlFor="minimal-alias">{t("minimal.alias")}</Label>
            <Input id="minimal-alias" required maxLength={100} value={alias} onChange={(e) => setAlias(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("minimal.aliasHint")}</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !alias.trim()}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("minimal.switchOn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

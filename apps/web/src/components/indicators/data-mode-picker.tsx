"use client";

import { CheckCircle2, FileSpreadsheet, KeyboardIcon, PlugZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type DataMode = "typed" | "files" | "connected";
const MODES: { mode: DataMode; icon: typeof KeyboardIcon }[] = [
  { mode: "typed", icon: KeyboardIcon },
  { mode: "files", icon: FileSpreadsheet },
  { mode: "connected", icon: PlugZap },
];

const skipKey = (clientId: string) => `selah.indicatorData.skipped.${clientId}`;
const listeners = new Set<() => void>();
function skipped(clientId: string) {
  try {
    return localStorage.getItem(skipKey(clientId)) === "1";
  } catch {
    return false;
  }
}

/**
 * How the client's figures reach Selah, in three plain choices with what
 * each one shares. The client's admin chooses (the firm, for a client with no
 * accounts); the firm can suggest one, which the admin then confirms. As a
 * setup step on the admin's overview it starts on "no data" and can be
 * skipped (it then shows again in this browser only after the page is
 * cleared; the choice stays "no data" until made).
 */
export function DataModePicker({
  clientId,
  mode,
  chosen,
  proposal,
  canChoose,
  canPropose,
  variant = "settings",
}: {
  clientId: string;
  mode: DataMode;
  chosen: boolean;
  proposal: { mode: DataMode; by: string | null } | null;
  canChoose: boolean;
  canPropose: boolean;
  variant?: "setup" | "settings";
}) {
  const t = useTranslations("indicatorData");
  const router = useRouter();
  const start = !chosen && proposal ? proposal.mode : mode;
  const [pick, setPick] = useState<DataMode>(start);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const isSkipped = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => skipped(clientId),
    () => false,
  );
  if (variant === "setup" && isSkipped) return null;

  async function save(kind: "choose" | "propose") {
    // Stepping back from "connected" disconnects every connection at once.
    if (kind === "choose" && chosen && mode === "connected" && pick !== "connected" && !(await confirm(t("downgradeConfirm")))) return;
    setBusy(true);
    const r =
      kind === "choose"
        ? await callApi(`/api/clients/${clientId}/indicator-data`, "PUT", { mode: pick })
        : await callApi(`/api/clients/${clientId}/indicator-data/propose`, "POST", { mode: pick });
    setBusy(false);
    if (!r.ok) return void toast.error(t("errors.generic"));
    toast.success(kind === "choose" ? t("saved") : t("proposed"));
    router.refresh();
  }

  function skip() {
    try {
      localStorage.setItem(skipKey(clientId), "1");
    } catch {
      // Storage blocked: it shows again on the next visit.
    }
    listeners.forEach((fn) => fn());
  }

  const editable = canChoose || canPropose;
  return (
    <div className="space-y-4">
      {confirmDialog}
      {proposal && !chosen ? (
        <p className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          {t("proposalNote", { mode: t(`modes.${proposal.mode}.title`), name: proposal.by ?? "—" })}
        </p>
      ) : null}
      <div role="radiogroup" aria-label={t("title")} className="grid gap-3 md:grid-cols-3">
        {MODES.map(({ mode: m, icon: Icon }) => {
          const selected = pick === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!editable}
              onClick={() => setPick(m)}
              className={cn(
                "flex h-full flex-col gap-2 rounded-xl border bg-surface p-4 text-start text-surface-foreground transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
                selected ? "border-foreground ring-1 ring-foreground" : "hover:bg-accent/60",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="size-4 text-muted-foreground" />
                  {t(`modes.${m}.title`)}
                </span>
                {chosen && mode === m ? (
                  <ToneBadge tone="active" className="gap-1">
                    <CheckCircle2 className="size-3" />
                    {t("current")}
                  </ToneBadge>
                ) : null}
              </span>
              <span className="text-xs font-medium text-muted-foreground">{t(`modes.${m}.short`)}</span>
              <span className="text-sm">{t(`modes.${m}.how`)}</span>
              <span className="text-xs text-muted-foreground">{t(`modes.${m}.privacy`)}</span>
            </button>
          );
        })}
      </div>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          {canChoose ? (
            <Button size="sm" disabled={busy || (chosen && pick === mode)} onClick={() => void save("choose")}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {chosen ? t("change") : t("confirm")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy || proposal?.mode === pick} onClick={() => void save("propose")}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("propose")}
            </Button>
          )}
          {variant === "setup" ? (
            <Button size="sm" variant="ghost" onClick={skip}>
              {t("skip")}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">{canChoose ? t("changeLater") : t("clientDecides")}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("clientDecides")}</p>
      )}
    </div>
  );
}

/**
 * The setup step on a client admin's overview until the choice is made:
 * "no data" (or the firm's suggestion) preselected, skippable in this browser.
 */
export function DataSetupCard({
  title,
  hint,
  clientId,
  proposal,
}: {
  title: string;
  hint: string;
  clientId: string;
  proposal: { mode: DataMode; by: string | null } | null;
}) {
  const isSkipped = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => skipped(clientId),
    () => false,
  );
  if (isSkipped) return null;
  return (
    <Card className="animate-page-in gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <DataModePicker variant="setup" clientId={clientId} mode="typed" chosen={false} proposal={proposal} canChoose canPropose={false} />
      </CardContent>
    </Card>
  );
}

"use client";

import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { IconTip } from "@/components/hint";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/toast";
import { ORG_CHART_LIMITS, orgChartError } from "@/lib/org-chart";
import type { Holding } from "@/services/org-chart";

export interface HolderCandidate {
  userId: string;
  name: string;
  email: string;
}

/** A refusal in the reader's language: the org chart's own sentence when there is one, else the common one. */
export function useOrgChartError() {
  const t = useTranslations("orgChart.errors");
  const tc = useTranslations("common");
  return (r: { error: string; message?: string }) => {
    const key = orgChartError(r.message);
    return key ? t(key as "name") : tc(`errors.${r.error}` as "errors.generic");
  };
}

/**
 * Who holds a position, for the people who change holders (the client's
 * admin on the published structure, the firm's editors there and in the
 * draft): everyone who holds or held it with their dates, "place someone"
 * (a person with a Selah account, or a typed name, from a day), ending a
 * holding, and removing one entered by mistake, which asks first because it
 * cannot be undone. The server checks every step (services/org-chart.ts).
 */
export function HoldersPanel(props: {
  positionId: string;
  plannedCount: number;
  candidates: HolderCandidate[];
  side: "firm" | "client";
  /** "Place someone" is the region's main action (the People view), or a secondary one (inside the details panel). */
  primary?: boolean;
}) {
  const t = useTranslations("orgChart.holders");
  const format = useFormatter();
  const router = useRouter();
  const say = useOrgChartError();
  const [confirm, confirmDialog] = useConfirm();
  const [list, setList] = useState<{ today: string; holdings: Holding[] } | null>(null);
  // Why the list did not load: the server's own words ("" when it gave none), shown as a sentence.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"account" | "typed">(props.candidates.length ? "account" : "typed");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<Holding | null>(null);
  const base = `/api/org-chart/positions/${props.positionId}/holders`;

  const apply = useCallback((r: Awaited<ReturnType<typeof callApi>>) => {
    if (!r.ok) return setLoadError(r.message ?? "");
    const d = r.data as { today: string; holdings: Holding[] };
    setList({ today: d.today, holdings: d.holdings });
    setFrom((f) => f ?? d.today);
  }, []);
  const load = async () => apply(await callApi(base, "GET"));

  useEffect(() => {
    let live = true;
    callApi(base, "GET").then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [base, apply]);

  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const current = (list?.holdings ?? []).filter((h) => h.current || h.upcoming);
  const earlier = (list?.holdings ?? []).filter((h) => !h.current && !h.upcoming);
  const replaced = props.plannedCount === 1 ? current.find((h) => h.current && h.to === null) : undefined;

  async function changed(message: string) {
    toast.success(message);
    await load();
    router.refresh();
  }

  async function place(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const start = mode === "account" ? { userId, from } : { name: name.trim(), from };
    const r = await callApi(base, "POST", { start });
    setBusy(false);
    if (!r.ok) return setError(say(r));
    setUserId("");
    setName("");
    await changed(t("placed"));
  }

  async function remove(h: Holding) {
    if (!(await confirm(t("removeConfirm", { name: h.name ?? "—" })))) return;
    const r = await callApi(`${base}/${h.id}`, "DELETE");
    if (!r.ok) return toast.error(say(r));
    await changed(t("removed"));
  }

  const menu = (h: Holding, canEnd: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconTip name="moreMenu">
          <Button variant="ghost" size="icon" className="size-7" aria-label={t("actions", { name: h.name ?? "—" })}>
            <Ellipsis className="size-4" />
          </Button>
        </IconTip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEnd ? <DropdownMenuItem onSelect={() => setEnding(h)}>{t("end")}</DropdownMenuItem> : null}
        {canEnd ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem variant="destructive" onSelect={() => void remove(h)}>
          {t("remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const who = (h: Holding) => (
    <span className="grid min-w-0">
      <span className="truncate font-medium" dir="auto">
        {h.name ?? "—"}
      </span>
      {h.typed ? <span className="text-xs text-muted-foreground">{t("typed")}</span> : null}
    </span>
  );

  return (
    <section aria-labelledby={`h-${props.positionId}`} className="grid gap-3">
      <div>
        <h3 id={`h-${props.positionId}`} className="text-sm font-semibold">
          {t("title")}
        </h3>
        <p className="text-xs text-muted-foreground">{props.side === "client" ? t("hintClient") : t("hintFirm")}</p>
      </div>
      {list === null && loadError === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <BrandLoader className="size-4" />
          {t("loading")}
        </p>
      ) : null}
      {loadError !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {say({ error: "generic", message: loadError || undefined })}
        </p>
      ) : null}
      {list ? (
        <>
          {current.length ? (
            <ul className="divide-y rounded-lg border">
              {current.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  {who(h)}
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {h.upcoming ? t("from", { date: day(h.from) }) : h.to ? t("range", { from: day(h.from), to: day(h.to) }) : t("since", { date: day(h.from) })}
                    {menu(h, h.to === null)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          )}
          {earlier.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{t("earlier")}</summary>
              <ul className="mt-2 divide-y rounded-lg border">
                {earlier.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    {who(h)}
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {t("range", { from: day(h.from), to: day(h.to ?? h.from) })}
                      {menu(h, false)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <form onSubmit={place} className="grid gap-3 rounded-lg bg-muted/50 p-3">
            <p className="text-sm font-medium">{t("place")}</p>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "account" | "typed")} className="gap-2">
              {props.candidates.length ? (
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="account" />
                  {t("withAccount")}
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="typed" />
                {t("typedName")}
              </label>
            </RadioGroup>
            {mode === "account" ? (
              <div className="grid gap-2">
                <Label htmlFor={`h-who-${props.positionId}`}>{t("pickPerson")}</Label>
                <PersonPicker
                  id={`h-who-${props.positionId}`}
                  key={`pick-${list.holdings.length}`}
                  required
                  options={props.candidates.map((c) => ({ value: c.userId, label: c.name, hint: c.email }))}
                  onValueChange={setUserId}
                  placeholder={t("pickPerson")}
                />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor={`h-name-${props.positionId}`}>{t("name")}</Label>
                <Input
                  id={`h-name-${props.positionId}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={ORG_CHART_LIMITS.holderName.min}
                  maxLength={ORG_CHART_LIMITS.holderName.max}
                  dir="auto"
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor={`h-from-${props.positionId}`}>{t("fromDate")}</Label>
              <DatePicker id={`h-from-${props.positionId}`} value={from} onChange={setFrom} required placeholder={t("fromDate")} />
              {replaced ? <p className="text-xs text-muted-foreground">{t("replaces", { name: replaced.name ?? "—" })}</p> : null}
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div>
              <Button type="submit" size="sm" variant={props.primary ? "default" : "outline"} disabled={busy || !from || (mode === "account" ? !userId : name.trim().length < 2)}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {t("place")}
              </Button>
            </div>
          </form>
        </>
      ) : null}

      {ending ? <EndHolding holding={ending} base={base} today={list?.today ?? ""} onClose={() => setEnding(null)} onEnded={() => changed(t("ended"))} /> : null}
      {confirmDialog}
    </section>
  );
}

/** "End this holding": the last day the person held the position (today by default). */
function EndHolding(props: { holding: Holding; base: string; today: string; onClose: () => void; onEnded: () => Promise<void> }) {
  const t = useTranslations("orgChart.holders");
  const tc = useTranslations("common");
  const say = useOrgChartError();
  const [on, setOn] = useState<string | undefined>(props.today || undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function end(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await callApi(props.base, "POST", { end: { holderId: props.holding.id, on } });
    setBusy(false);
    if (!r.ok) return setError(say(r));
    props.onClose();
    await props.onEnded();
  }
  return (
    <Dialog open onOpenChange={(o) => (o ? null : props.onClose())}>
      <DialogContent>
        <form onSubmit={end} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("endTitle", { name: props.holding.name ?? "—" })}</DialogTitle>
            <DialogDescription>{t("endHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="h-end">{t("lastDay")}</Label>
            <DatePicker id="h-end" value={on} onChange={setOn} required placeholder={t("lastDay")} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !on}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("endButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

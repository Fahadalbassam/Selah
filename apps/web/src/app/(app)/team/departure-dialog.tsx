"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PersonPicker } from "@/components/person-picker";
import { Textarea } from "@/components/ui/textarea";

type Kind = "action" | "client_lead" | "project_lead" | "review" | "client_role" | "department_head";
interface Holding {
  kind: Kind;
  entityId: string;
  projectId: string | null;
  title: string;
  detail: string | null;
  blocking: boolean;
}
// Clients and departments carry their Arabic name in detail.
const named = (h: Holding, ar: boolean) =>
  ar && h.detail && (h.kind === "client_lead" || h.kind === "department_head") ? h.detail : h.title;
// The database's own words (English) for the refusals people can hit here.
const KNOWN: Record<string, string> = {
  "the firm needs at least one active admin": "lastAdmin",
  "hand over to an active member of the same organisation": "badReceiver",
  "every client with consultants needs a lead consultant": "needsLead",
  "hand over what this person still holds before switching the account off": "stillHoldsError",
};
const ORDER: Kind[] = ["action", "client_lead", "project_lead", "review", "client_role", "department_head"];
const href = (h: Holding) =>
  h.kind === "action" || h.kind === "review"
    ? `/actions/${h.entityId}`
    : h.kind === "client_lead"
      ? `/clients/${h.entityId}`
      : h.kind === "department_head"
        ? "/departments"
        : h.projectId
          ? `/projects/${h.projectId}`
          : null;

/**
 * Switching someone off (F26): first the departing-person report (what they
 * still hold), then a one-step hand-over to a colleague, then the switch-off
 * itself, which stays disabled while blocking work remains. The database
 * refuses the same. Mounted only while open, so each opening reloads.
 */
export function DepartureDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  name: string;
  colleagues: { userId: string; name: string }[];
}) {
  const t = useTranslations("people.departure");
  const tc = useTranslations("common");
  const tStatus = useTranslations("status");
  const tRole = useTranslations("clientRoles.roles");
  const router = useRouter();
  const ar = useLocale() === "ar";
  const [items, setItems] = useState<Holding[] | null>(null);
  const [to, setTo] = useState<string>("");
  const [roles, setRoles] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "hand" | "off">(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/people/${props.userId}`;
  const say = (r: { error: string; message?: string }) => {
    const known = r.message && Object.keys(KNOWN).find((m) => r.message!.startsWith(m));
    setError(known ? t(`errors.${KNOWN[known]}`) : tc(`errors.${r.error}`));
  };

  useEffect(() => {
    let live = true;
    fetch(`${base}/holdings`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: Holding[] }) => live && setItems(d.items))
      .catch(() => live && setError(tc("errors.generic")));
    return () => {
      live = false;
    };
  }, [base, tc]);

  const blocking = items?.filter((i) => i.blocking).length ?? 0;
  const movable = (items ?? []).filter((i) => i.kind !== "department_head" && (i.blocking || roles));
  const kinds = [...new Set(movable.map((i) => i.kind))];

  async function handOver() {
    setBusy("hand");
    setError(null);
    const r = await callApi(`${base}/hand-over`, "POST", { to, kinds });
    setBusy(null);
    if (!r.ok) return say(r);
    const d = r.data as { moved: number; items: Holding[] };
    setItems(d.items);
    toast.success(t("handed", { n: d.moved }));
    router.refresh();
  }

  async function switchOff() {
    setBusy("off");
    setError(null);
    const r = await callApi(base, "PATCH", { active: false, reason: reason.trim() });
    setBusy(null);
    if (!r.ok) return say(r);
    props.onOpenChange(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title", { name: props.name })}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>

        {items === null && !error ? (
          <div className="flex justify-center py-6">
            <BrandLoader className="size-5" />
          </div>
        ) : null}

        {items && items.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            <CircleCheck className="size-4 shrink-0" />
            {t("nothing")}
          </p>
        ) : null}

        {items && items.length > 0 ? (
          <div className="grid gap-3">
            {ORDER.filter((k) => items.some((i) => i.kind === k)).map((k) => {
              const list = items.filter((i) => i.kind === k);
              return (
                <div key={k} className="rounded-lg border">
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
                    <p className="text-sm font-medium">
                      {t(`kinds.${k}`)} <span className="text-muted-foreground tabular-nums">({list.length})</span>
                    </p>
                    <ToneBadge tone={list[0]!.blocking ? "problem" : "waiting"}>{list[0]!.blocking ? t("blocks") : t("interim")}</ToneBadge>
                  </div>
                  <ul className="divide-y">
                    {list.slice(0, 8).map((h) => {
                      const link = href(h);
                      return (
                        <li key={h.entityId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                          {link ? (
                            <Link href={link} className="truncate hover:underline" dir="auto">
                              {named(h, ar)}
                            </Link>
                          ) : (
                            <span className="truncate" dir="auto">
                              {named(h, ar)}
                            </span>
                          )}
                          {h.detail && (k === "client_role" || k === "action") ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {k === "action" ? tStatus(h.detail as never) : tRole(h.detail as never)}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                    {list.length > 8 ? <li className="px-4 py-2 text-xs text-muted-foreground">{t("more", { n: list.length - 8 })}</li> : null}
                  </ul>
                </div>
              );
            })}

            {items.some((i) => i.kind !== "department_head") ? (
              <div className="grid gap-3 rounded-lg bg-muted/50 p-4">
                <div className="grid gap-2">
                  <Label htmlFor="d-to">{t("to")}</Label>
                  <div className="max-w-sm">
                    <PersonPicker
                      id="d-to"
                      defaultValue={to || undefined}
                      onValueChange={setTo}
                      placeholder={t("toPlaceholder")}
                      options={props.colleagues.map((c) => ({ value: c.userId, label: c.name }))}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("toHint")}</p>
                </div>
                {items.some((i) => i.kind === "client_role") ? (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={roles} onCheckedChange={(v) => setRoles(v === true)} className="mt-0.5" />
                    <span>{t("rolesToo")}</span>
                  </label>
                ) : null}
                <div>
                  <Button type="button" size="sm" disabled={!to || kinds.length === 0 || busy !== null} onClick={handOver}>
                    {busy === "hand" ? <BrandLoader tone="current" className="size-4" /> : null}
                    {t("handOver")}
                  </Button>
                </div>
              </div>
            ) : null}
            {items.some((i) => i.kind === "department_head") ? <p className="text-sm text-muted-foreground">{t("departments")}</p> : null}
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="d-reason">{t("reason")}</Label>
          <Textarea id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
          {blocking > 0 ? <p className="text-xs text-muted-foreground">{t("stillHolds", { n: blocking })}</p> : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={items === null || blocking > 0 || !reason.trim() || busy !== null} onClick={switchOff}>
            {busy === "off" ? <BrandLoader tone="current" className="size-4" /> : null}
            {t("switchOff")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

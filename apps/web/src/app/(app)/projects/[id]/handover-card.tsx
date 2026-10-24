"use client";

import { Circle } from "lucide-react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface Handover {
  kind: "client" | "internal";
  handoverOn: string | null;
  state: "draft" | "planned" | "active" | "closed";
  closedAt: string | Date | null;
  sponsor: { id: string; name: string | null } | null;
  checkins: {
    id: string;
    day: number | null;
    dueAt: string | Date | null;
    status: "open" | "done";
    assignee: string | null;
    canComplete: boolean;
  }[];
  can: { edit: boolean };
}

/** The handover date, the client's sponsor and the firm's check-ins after it. */
export function HandoverCard({ projectId, data }: { projectId: string; data: Handover }) {
  const t = useTranslations("handover");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const closed = data.state === "closed";
  const client = data.kind === "client";
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00`), { dateStyle: "medium" });

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const date = String(new FormData(e.currentTarget).get("handoverOn") ?? "");
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/projects/${projectId}/handover`, "PATCH", date ? { handoverOn: date } : {});
    setBusy(false);
    if (!r.ok) return setError(r.message ?? tc(`errors.${r.error}`));
    setOpen(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  async function setState(state: "active" | "closed") {
    if (!(await confirm(t(state === "closed" ? "closeConfirm" : "reopenConfirm")))) return;
    const r = await callApi(`/api/projects/${projectId}/state`, "PATCH", { state });
    if (!r.ok) return toast.error(r.message ?? tc(`errors.${r.error}`));
    toast.success(tc("saved"));
    router.refresh();
  }

  async function complete(id: string, done: boolean) {
    const r = await callApi(`/api/follow-ups/${id}`, "PATCH", { status: done ? "done" : "open" });
    if (r.ok) router.refresh();
    else toast.error(r.message ?? tc(`errors.${r.error}`));
  }

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>
          {data.handoverOn
            ? data.checkins.length
              ? t("hintDone")
              : t("hintAfter")
            : data.can.edit
              ? t("hint")
              : t("hintPending")}
        </CardDescription>
        {data.can.edit ? (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => (setError(null), setOpen(true))}>
              {data.handoverOn ? t("change") : t("set")}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">{t("date")}</dt>
            <dd className="tabular-nums">{data.handoverOn ? day(data.handoverOn) : t("notYet")}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">{t("projectState")}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">
                {closed && data.closedAt
                  ? t("closedOn", { date: format.dateTime(new Date(data.closedAt), { dateStyle: "medium" }) })
                  : data.state === "draft"
                    ? t("draft")
                    : t("open")}
              </span>
              {/* A draft starts when a signed engagement covers it, not from here. */}
              {data.can.edit && data.state !== "draft" ? (
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setState(closed ? "active" : "closed")}>
                  {closed ? t("reopenProject") : t("closeProject")}
                </Button>
              ) : null}
            </dd>
          </div>
          {client ? (
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">{t("sponsor")}</dt>
              <dd>{data.sponsor?.name ?? t("noSponsor")}</dd>
            </div>
          ) : null}
        </dl>
        {client ? <p className="text-xs text-muted-foreground">{t("sponsorHint")}</p> : null}
        {data.checkins.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("checkins")}</p>
            <ul className="divide-y rounded-lg border">
              {data.checkins.map((c) => {
                const done = c.status === "done";
                return (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    {done ? (
                      <CircleCheck className="size-4 text-success" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground" />
                    )}
                    <span className={cn("flex-1", done && "text-muted-foreground")}>{t("checkin", { n: c.day ?? 0 })}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {c.dueAt ? format.dateTime(new Date(c.dueAt), { dateStyle: "medium" }) : "—"}
                    </span>
                    <span className="hidden w-32 truncate text-xs text-muted-foreground md:block">
                      {c.assignee ?? t("unassigned")}
                    </span>
                    {c.canComplete ? (
                      <Button variant="ghost" size="sm" onClick={() => complete(c.id, !done)}>
                        {done ? t("reopen") : t("markDone")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>

      {confirmDialog}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("dialogHint")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="h-date">{t("date")}</Label>
              <DatePicker id="h-date" name="handoverOn" defaultValue={data.handoverOn ?? undefined} placeholder={t("date")} />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {tc("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

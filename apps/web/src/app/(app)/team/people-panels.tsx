"use client";

import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** A dialog with one form that calls one API route, then refreshes the page. */
function ActionDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  destructive?: boolean;
  children: ReactNode;
  send: (form: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await props.send(new FormData(e.currentTarget));
    setBusy(false);
    if (!r.ok) return setError(r.message ?? t(`errors.${r.error ?? "generic"}`));
    props.onOpenChange(false);
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => (props.onOpenChange(o), setError(null))}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          {props.children}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant={props.destructive ? "destructive" : "default"} disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const reasonField = (label: string, min = 1) => (
  <div className="grid gap-2">
    <Label htmlFor="p-reason">{label}</Label>
    <Textarea id="p-reason" name="reason" required minLength={min} maxLength={500} rows={3} />
  </div>
);
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

type Open = null | "email" | "off" | "twoFactor" | "erase";

/** The menu of what an admin can do to one person. The server decides again. */
export function PersonMenu(props: {
  userId: string;
  name: string;
  active: boolean;
  canChange: boolean;
  canResetTwoFactor: boolean;
  canErase: boolean;
}) {
  const t = useTranslations("people");
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const set = (o: boolean) => !o && setOpen(null);
  const base = `/api/people/${props.userId}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("actions", { name: props.name })}>
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {props.active && props.canChange ? (
            <DropdownMenuItem onSelect={() => setOpen("email")}>{t("changeEmail")}</DropdownMenuItem>
          ) : null}
          {props.active && props.canResetTwoFactor ? (
            <DropdownMenuItem onSelect={() => setOpen("twoFactor")}>{t("resetTwoFactor")}</DropdownMenuItem>
          ) : null}
          {props.active ? (
            <DropdownMenuItem onSelect={() => setOpen("off")}>{t("switchOff")}</DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={async () => {
                const r = await callApi(base, "PATCH", { active: true });
                if (r.ok) router.refresh();
                else toast.error(r.message ?? r.error);
              }}
            >
              {t("switchOn")}
            </DropdownMenuItem>
          )}
          {props.canErase ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setOpen("erase")}>
                {t("erase")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ActionDialog
        open={open === "email"}
        onOpenChange={set}
        title={`${t("changeEmail")}: ${props.name}`}
        description={t("changeEmailHint")}
        submitLabel={t("changeEmail")}
        send={(f) => callApi(`${base}/email-change`, "POST", { newEmail: field(f, "newEmail") })}
      >
        <div className="grid gap-2">
          <Label htmlFor="p-email">{t("newEmail")}</Label>
          <Input id="p-email" name="newEmail" type="email" required maxLength={254} dir="ltr" />
        </div>
      </ActionDialog>
      <ActionDialog
        open={open === "off"}
        onOpenChange={set}
        title={`${t("switchOff")}: ${props.name}`}
        description={t("switchOffHint")}
        submitLabel={t("switchOff")}
        destructive
        send={(f) => callApi(base, "PATCH", { active: false, reason: field(f, "reason") })}
      >
        {reasonField(t("reason"))}
      </ActionDialog>
      <ActionDialog
        open={open === "twoFactor"}
        onOpenChange={set}
        title={`${t("resetTwoFactor")}: ${props.name}`}
        description={t("resetTwoFactorHint")}
        submitLabel={t("resetTwoFactor")}
        send={(f) => callApi(`${base}/two-factor-reset`, "POST", { reason: field(f, "reason") })}
      >
        {reasonField(t("reason"))}
      </ActionDialog>
      <ActionDialog
        open={open === "erase"}
        onOpenChange={set}
        title={`${t("erase")}: ${props.name}`}
        description={t("eraseHint")}
        submitLabel={t("erase")}
        destructive
        send={(f) => callApi(`${base}/erase`, "POST", { reason: field(f, "reason") })}
      >
        {reasonField(t("reason"), 3)}
      </ActionDialog>
    </>
  );
}

/** Edit the organisation's allowed email domains. */
export function DomainsDialog({ orgId, domains, firm }: { orgId: string; domains: string[]; firm: boolean }) {
  const t = useTranslations("people");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("domainsEdit")}
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title={t("domains")}
        description={firm ? `${t("domainsHint")} ${t("domainsFirm")}` : t("domainsHint")}
        submitLabel={t("domainsEdit")}
        send={(f) =>
          callApi(`/api/orgs/${orgId}/email-domains`, "PUT", {
            domains: field(f, "domains")
              .split(/[,\s،]+/)
              .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
              .filter(Boolean),
          })
        }
      >
        <div className="grid gap-2">
          <Label htmlFor="p-domains">{t("domainsField")}</Label>
          <Input id="p-domains" name="domains" defaultValue={domains.join(", ")} dir="ltr" required={firm} />
        </div>
      </ActionDialog>
    </>
  );
}

/** "Are these people still with you?" Everyone ticked stays; the others are switched off with a reason. */
export function AccessReview({
  orgId,
  people,
}: {
  orgId: string;
  people: { userId: string; name: string; email: string; self: boolean }[];
}) {
  const t = useTranslations("people");
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const toggle = (id: string, stays: boolean) =>
    setLeaving((s) => {
      const n = new Set(s);
      if (stays) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <Button size="sm" onClick={() => (setLeaving(new Set()), setOpen(true))}>
        {t("reviewStart")}
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title={t("reviewTitle")}
        description={t("reviewDialogHint")}
        submitLabel={t("submitReview")}
        send={(f) =>
          callApi(`/api/orgs/${orgId}/access-reviews`, "POST", {
            deactivate: [...leaving].map((userId) => ({ userId, reason: field(f, `reason-${userId}`) })),
          })
        }
      >
        <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
          {people.map((p) => (
            <li key={p.userId} className="space-y-2 px-3 py-2.5">
              <label className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={!leaving.has(p.userId)}
                  disabled={p.self}
                  onCheckedChange={(v) => toggle(p.userId, v === true)}
                  aria-label={`${t("stillHere")}: ${p.name}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                    {p.email}
                  </span>
                </span>
              </label>
              {leaving.has(p.userId) ? (
                <Input
                  name={`reason-${p.userId}`}
                  required
                  maxLength={500}
                  placeholder={t("leftBecause")}
                  aria-label={t("leftBecause")}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </ActionDialog>
    </>
  );
}

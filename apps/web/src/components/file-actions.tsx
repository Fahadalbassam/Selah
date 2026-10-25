"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPTED_EXTENSIONS } from "@/lib/upload-rules";

export interface FileActionsProps {
  id: string;
  title: string;
  visibility: "shared" | "firm_private" | "client_private" | "user_private";
  aiIndexable: boolean;
  /** From fileControls() on the server; the server decides again. */
  can: { shareWithClient: boolean; shareWithFirm: boolean; assistant: boolean; newVersion: boolean; withdraw: boolean };
  /** After a change; refreshes the page when not given. */
  onChanged?: () => void;
}

/**
 * What the owning side can do to a file besides opening it: share it with
 * the other side (one-way), let the assistant read it or not, and upload a
 * new version. Used wherever files are listed, so every screen offers the
 * same choices. Renders nothing when there is nothing to offer.
 */
export function FileActions({ id, title, visibility, aiIndexable, can, onChanged }: FileActionsProps) {
  const t = useTranslations("fileActions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [versionOpen, setVersionOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => (onChanged ? onChanged() : router.refresh());

  if (!can.shareWithClient && !can.shareWithFirm && !can.assistant && !can.newVersion && !can.withdraw) return null;

  async function share(message: string) {
    if (!(await confirm(message))) return;
    const r = await callApi(`/api/documents/${id}/share`, "POST");
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    toast.success(t("shared"));
    done();
  }

  async function assistant(on: boolean) {
    if (!(await confirm(on ? t("assistantOnConfirm") : t("assistantOffConfirm")))) return;
    const r = await callApi(`/api/documents/${id}/assistant`, "PUT", { on });
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    toast.success(on ? t("assistantOn") : t("assistantOff"));
    done();
  }

  async function withdraw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/documents/${id}/withdraw`, "POST", { reason });
    setBusy(false);
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    toast.success(t("withdrawn"));
    setWithdrawOpen(false);
    done();
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}/versions`, { method: "POST", body: form });
      if (res.ok) {
        toast.success(t("versionAdded"));
        setVersionOpen(false);
        done();
        return;
      }
      const m = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "";
      setError(
        res.status === 503
          ? t("errors.scanner")
          : m.includes("infected")
            ? t("errors.infected")
            : m.includes("too large")
              ? t("errors.tooLarge")
              : m.includes("rejected")
                ? t("errors.type")
                : tc("errors.generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("menu", { title })} title={t("menu", { title })}>
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.shareWithClient ? <DropdownMenuItem onSelect={() => share(t("shareWithClientConfirm"))}>{t("shareWithClient")}</DropdownMenuItem> : null}
          {can.shareWithFirm ? <DropdownMenuItem onSelect={() => share(t("shareWithFirmConfirm"))}>{t("shareWithFirm")}</DropdownMenuItem> : null}
          {can.assistant ? (
            <DropdownMenuItem onSelect={() => assistant(!aiIndexable)}>{aiIndexable ? t("assistantTurnOff") : t("assistantTurnOn")}</DropdownMenuItem>
          ) : null}
          {can.newVersion ? <DropdownMenuItem onSelect={() => setVersionOpen(true)}>{t("newVersion")}</DropdownMenuItem> : null}
          {can.withdraw ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setWithdrawOpen(true)}>
              {t("withdraw")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
      <Dialog open={withdrawOpen} onOpenChange={(o) => (setWithdrawOpen(o), setError(null))}>
        <DialogContent>
          <form onSubmit={withdraw} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("withdraw")}</DialogTitle>
              <DialogDescription>{t("withdrawHint", { title })}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`withdraw-${id}`}>{t("withdrawReason")}</Label>
              <Textarea id={`withdraw-${id}`} name="reason" required minLength={3} maxLength={500} rows={3} />
            </div>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWithdrawOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {t("withdraw")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={versionOpen} onOpenChange={(o) => (setVersionOpen(o), setError(null))}>
        <DialogContent>
          <form onSubmit={upload} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("newVersion")}</DialogTitle>
              <DialogDescription>{t(visibility === "shared" ? "newVersionHintShared" : "newVersionHint", { title })}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`version-${id}`}>{t("file")}</Label>
              <Input id={`version-${id}`} name="file" type="file" accept={ACCEPTED_EXTENSIONS} required />
            </div>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setVersionOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {t("upload")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

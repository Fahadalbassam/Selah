"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { IconTip } from "@/components/hint";
import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { AudienceEditor, AudienceField, useAudienceRefusal, type AudienceValue } from "@/components/audience-field";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { SendFileDialog, uploadErrorKey } from "@/components/send-file-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Bot } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface FileActionsProps {
  id: string;
  title: string;
  visibility: "shared" | "firm_private" | "client_private" | "user_private";
  aiIndexable: boolean;
  /** From fileControls() on the server; the server decides again. */
  can: {
    shareWithClient: boolean;
    shareWithFirm: boolean;
    assistant: boolean;
    /** The switch is someone else's (D1): which side's admin may change it, besides the uploader. */
    assistantLocked?: "firm" | "client" | null;
    newVersion: boolean;
    withdraw: boolean;
    audience?: boolean;
  };
  /** Who uploaded it, when the reader may see that name: said when the switch is someone else's. */
  uploaderName?: string | null;
  /** After a change; refreshes the page when not given. */
  onChanged?: () => void;
  /** The assistant may read this file here: said as the menu's first line, not a badge on the row (October review, item 7). */
  assistantReads?: boolean;
}

/**
 * What the owning side can do to a file besides opening it: share it with
 * the other side (one-way), let the assistant read it or not, and upload a
 * new version. Used wherever files are listed, so every screen offers the
 * same choices. Renders nothing when there is nothing to offer.
 */
export function FileActions({ id, title, visibility, aiIndexable, can, onChanged, assistantReads = false, uploaderName = null }: FileActionsProps) {
  const t = useTranslations("fileActions");
  const tc = useTranslations("common");
  const ta = useTranslations("audience");
  const refusal = useAudienceRefusal();
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [versionOpen, setVersionOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  // Who sees the file once shared, chosen in the share dialog; null while it cannot be saved.
  const [audience, setAudience] = useState<{ value: AudienceValue | null; dirty: boolean }>({ value: null, dirty: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => (onChanged ? onChanged() : router.refresh());

  if (!assistantReads && !can.shareWithClient && !can.shareWithFirm && !can.assistant && !can.assistantLocked && !can.newVersion && !can.withdraw && !can.audience)
    return null;

  async function share(message: string) {
    if (!(await confirm(message))) return;
    const r = await callApi(`/api/documents/${id}/share`, "POST", {});
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    toast.success(t("shared"));
    done();
  }

  // The firm shares a deliverable with the client, and may choose who at the client and the firm sees it.
  async function shareWithClient(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (audience.dirty && !audience.value) return;
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/documents/${id}/share`, "POST", audience.dirty && audience.value ? { audience: audience.value } : {});
    setBusy(false);
    if (!r.ok) return setError(refusal(r.message) ?? tc(`errors.${r.error}`));
    toast.success(t("shared"));
    setShareOpen(false);
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

  async function upload(form: FormData) {
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
      const key = uploadErrorKey(res.status, m);
      setError(key === "generic" ? tc("errors.generic") : t(`errors.${key}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconTip name="moreMenu">
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("menu", { title })}>
              <Ellipsis className="size-4" />
            </Button>
          </IconTip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {assistantReads ? (
            <>
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                <Bot className="size-3.5" />
                {t("assistantReads")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {can.shareWithClient ? (
            <DropdownMenuItem onSelect={() => (setAudience({ value: null, dirty: false }), setError(null), setShareOpen(true))}>
              {t("shareWithClient")}
            </DropdownMenuItem>
          ) : null}
          {can.audience ? <DropdownMenuItem onSelect={() => setAudienceOpen(true)}>{ta("menu")}</DropdownMenuItem> : null}
          {can.shareWithFirm ? <DropdownMenuItem onSelect={() => share(t("shareWithFirmConfirm"))}>{t("shareWithFirm")}</DropdownMenuItem> : null}
          {can.assistant ? (
            <DropdownMenuItem onSelect={() => assistant(!aiIndexable)}>{aiIndexable ? t("assistantTurnOff") : t("assistantTurnOn")}</DropdownMenuItem>
          ) : can.assistantLocked ? (
            <DropdownMenuLabel className="max-w-64 text-xs font-normal text-muted-foreground">
              <AssistantWho side={can.assistantLocked} uploaderName={uploaderName} />
            </DropdownMenuLabel>
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
      <Dialog open={shareOpen} onOpenChange={(o) => (setShareOpen(o), setError(null))}>
        <DialogContent>
          <form onSubmit={shareWithClient} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("shareWithClient")}</DialogTitle>
              <DialogDescription>{t("shareWithClientConfirm")}</DialogDescription>
            </DialogHeader>
            {shareOpen ? (
              <AudienceField
                kind="document"
                url={`/api/documents/${id}/audience?shared=1`}
                onChange={(value, dirty) => setAudience({ value, dirty })}
                disabled={busy}
              />
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShareOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={busy || (audience.dirty && !audience.value)}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {t("shareWithClient")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={audienceOpen} onOpenChange={setAudienceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ta("dialogTitle", { kind: "document" })}</DialogTitle>
            <DialogDescription>{ta("dialogHint")}</DialogDescription>
          </DialogHeader>
          {audienceOpen ? <AudienceEditor kind="document" id={id} onSaved={() => (setAudienceOpen(false), done())} /> : null}
        </DialogContent>
      </Dialog>
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
      <SendFileDialog
        control={{ open: versionOpen, onOpenChange: setVersionOpen }}
        onOpenChange={() => setError(null)}
        title={t("newVersion")}
        description={t(visibility === "shared" ? "newVersionHintShared" : "newVersionHint", { title })}
        busy={busy}
        error={error}
        submitLabel={t("upload")}
        onSubmit={(form) => void upload(form)}
      />
    </>
  );
}

/** Who may switch the assistant for a file that is someone else's (D1): its uploader, or the side's admin. */
export function AssistantWho({ side, uploaderName }: { side: "firm" | "client"; uploaderName?: string | null }) {
  const t = useTranslations("fileActions.assistantWho");
  return <>{uploaderName ? t(side, { name: uploaderName }) : t(`${side}Unnamed`)}</>;
}

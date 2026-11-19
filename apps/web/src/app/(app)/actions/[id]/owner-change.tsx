"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OwnerControl } from "@/services/action-owner";
import { ErrorText, json, send, useRun } from "./action-panel";

/**
 * "Give to a colleague" (decision D1): beside the owner in the side panel,
 * drawn only for someone the database lets change it (the firm's staff on
 * the project, the client's admin, the project's coordinator and sponsor).
 * A colleague on the project, or on a client the firm runs a typed name (a
 * job title on a minimal-records client). The status does not change; who
 * is told is said before the click.
 */
export function OwnerChange({ actionId, projectId, control, firmView }: { actionId: string; projectId: string; control: OwnerControl; firmView: boolean }) {
  const t = useTranslations("action.ownerChange");
  const ta = useTranslations("action");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [name, setName] = useState("");
  const { busy, error, go, setError } = useRun(() => router.refresh());
  const typed = control.mode === "typed";
  const ready = typed ? name.trim().length >= 2 : !!to;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    go(() => send(`/api/actions/${actionId}/owner`, json(typed ? { ownerName: name.trim() } : { ownerUserId: to })), () => setOpen(false));
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null), setTo(""), setName(""))}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs">
          {t("change")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t(firmView ? "hintFirm" : "hintClient")}</DialogDescription>
          </DialogHeader>
          {typed ? (
            <div className="grid gap-2">
              <Label htmlFor="owner-name">{control.minimal ? t("jobTitle") : t("name")}</Label>
              <Input id="owner-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} dir="auto" required />
              <p className="text-xs text-muted-foreground">{control.minimal ? t("jobTitleHint") : t("nameHint")}</p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="owner-to">{t("to")}</Label>
              {control.people.length ? (
                <PersonPicker id="owner-to" options={control.people.map((p) => ({ value: p.id, label: p.name }))} onValueChange={setTo} placeholder={t("toPlaceholder")} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("nobody")}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {control.canAddToProject ? (
                  <>
                    {t("notListed")}{" "}
                    <Link href={`/projects/${projectId}?tab=people`} className="underline underline-offset-4 hover:text-foreground">
                      {t("addToProject")}
                    </Link>
                  </>
                ) : (
                  t("onlyProject")
                )}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("told")}</p>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {ta("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("give")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { OwnerControl } from "@/services/action-owner";

/**
 * "Reassign their actions first" on a project's People tab (review S3, the
 * coordinator's decision): the person's open actions on this project, each
 * with its own owner control (decision D1), so they can come off the project.
 * Drawn only for someone the server lets reassign at least one of them. It
 * never opens the switch-off dialog, whose hand-over moves everything a
 * person holds on every project.
 */
export function ReassignActions({ name, actions, firm }: { name: string; actions: { id: string; title: string; control: OwnerControl }[]; firm: boolean }) {
  const t = useTranslations("projectPeople");
  const to = useTranslations("action.ownerChange");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs">
          {t("reassignFirst")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("reassignTitle", { name })}</DialogTitle>
          <DialogDescription>{to(firm ? "hintFirm" : "hintClient")}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-xl border">
          {actions.map((a) => (
            <ReassignRow key={a.id} action={a} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function ReassignRow({ action }: { action: { id: string; title: string; control: OwnerControl } }) {
  const t = useTranslations("action.ownerChange");
  const tc = useTranslations("common");
  const ta = useTranslations("action.errors");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const typed = action.control.mode === "typed";
  async function give() {
    setBusy(true);
    const r = await callApi(`/api/actions/${action.id}/owner`, "POST", typed ? { ownerName: value.trim() } : { ownerUserId: value });
    setBusy(false);
    if (!r.ok) return void toast.error(r.message?.includes("full client's admin does not own actions") ? ta("fullAdminOwner") : tc(`errors.${r.error}`));
    toast.success(tc("saved"));
    router.refresh();
  }
  return (
    <li className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-center">
      <Link href={`/actions/${action.id}`} className="font-medium hover:underline" dir="auto">
        {action.title}
      </Link>
      {typed ? (
        <Input aria-label={action.control.minimal ? t("jobTitle") : t("name")} value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} dir="auto" />
      ) : action.control.people.length ? (
        <PersonPicker options={action.control.people.map((p) => ({ value: p.id, label: p.name, alt: p.nameAlt ? [p.nameAlt] : undefined }))} onValueChange={setValue} placeholder={t("toPlaceholder")} />
      ) : (
        <span className="text-xs text-muted-foreground">{t("nobody")}</span>
      )}
      <Button type="button" variant="outline" size="sm" disabled={busy || (typed ? value.trim().length < 2 : !value)} onClick={() => void give()}>
        {busy ? <BrandLoader tone="current" className="size-4" /> : null}
        {t("give")}
      </Button>
    </li>
  );
}

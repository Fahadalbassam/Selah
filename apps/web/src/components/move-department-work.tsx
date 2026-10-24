"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Counts {
  recommendations: number;
  actions: number;
  files: number;
}

/**
 * A restructure (F31): move a department's unfinished work to another of the
 * client's departments, and switch it off. The database decides what moves;
 * the dialog shows its count first.
 */
export function MoveDepartmentWork({
  department,
  name,
  active,
  targets,
}: {
  department: string;
  name: string;
  active: boolean;
  targets: { id: string; name: string }[];
}) {
  const t = useTranslations("engagement.departments.move");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const [switchOff, setSwitchOff] = useState(active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    setError(null);
    if (!next) return;
    setCounts(null);
    const r = await callApi(`/api/departments/${department}/move`, "GET");
    if (r.ok) setCounts(r.data as Counts);
    else setError(r.error);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/departments/${department}/move`, "POST", { to, switchOff });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    toast.success(t("done", { ...(r.data as Counts) }));
    router.refresh();
  }

  const nothing = counts !== null && counts.recommendations + counts.actions === 0;
  return (
    <Dialog open={open} onOpenChange={(o) => void onOpenChange(o)}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7" aria-label={t("open")} title={t("open")}>
          <ArrowRightLeft />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("title", { name })}</DialogTitle>
            <DialogDescription>{t("hint", { name })}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            {counts === null && !error ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <BrandLoader tone="current" className="size-4" />
                {t("counting")}
              </span>
            ) : counts ? (
              nothing ? (
                <span className="text-muted-foreground">{t("nothing", { name })}</span>
              ) : (
                <span>{t("count", { ...counts })}</span>
              )
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`move-to-${department}`}>{t("to")}</Label>
            <Select value={to} onValueChange={setTo} required>
              <SelectTrigger id={`move-to-${department}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {active ? (
            <div className="flex items-start gap-2">
              <Checkbox id={`move-off-${department}`} checked={switchOff} onCheckedChange={(v) => setSwitchOff(v === true)} />
              <div className="grid gap-1">
                <Label htmlFor={`move-off-${department}`}>{t("switchOff", { name })}</Label>
                <p className="text-xs text-muted-foreground">{t("switchOffHint")}</p>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tc(`errors.${error}`)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || counts === null || !to || (nothing && !switchOff)}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? tc("saving") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

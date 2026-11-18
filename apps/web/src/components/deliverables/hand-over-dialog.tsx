"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";

interface Choice {
  key: string;
  projectTitle: string;
  versions: { id: string; version: number; title: string; createdAt: string }[];
  picked: boolean;
}

interface Choices {
  files: Choice[];
  firmOnly: { title: string; projectTitle: string }[];
}

/**
 * Hand a deliverable over (F21): one line per file already shared with the
 * client, at its latest version unless an earlier one is picked. A hand-over
 * never shares anything: a file still firm-only is named in one line, which
 * points to the file's own Share action. The server lists the files and decides.
 */
export function HandOverDialog({ deliverableId, title, trigger, firmRun }: { deliverableId: string; title: string; trigger: ReactNode; firmRun: boolean }) {
  const t = useTranslations("deliverables");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [firmOnly, setFirmOnly] = useState<Choices["firmOnly"]>([]);
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setChoices(null);
    setError(null);
    const r = await callApi(`/api/deliverables/${deliverableId}/hand-over`, "GET");
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    const { files: list, firmOnly: hidden } = r.data as Choices;
    setChoices(list);
    setFirmOnly(hidden);
    setPicked(Object.fromEntries(list.map((c) => [c.key, c.picked ? c.versions[0]!.id : null])));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const versionIds = Object.values(picked).filter((v): v is string => !!v);
    if (!versionIds.length) return setError(t("pickOne"));
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/deliverables/${deliverableId}/hand-over`, "POST", { versionIds });
    setBusy(false);
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    setOpen(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle dir="auto">{t("handOverTitle", { title })}</DialogTitle>
            <DialogDescription>{firmRun ? t("handOverHintFirmRun") : t("handOverHint")}</DialogDescription>
          </DialogHeader>
          {choices === null && !error ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <BrandLoader className="size-4" />
              {t("loading")}
            </p>
          ) : null}
          {choices && choices.length === 0 ? <p className="text-sm text-muted-foreground">{t("noFiles")}</p> : null}
          {choices && choices.length ? (
            <ul className="grid gap-3">
              {choices.map((c) => {
                const chosen = picked[c.key] ?? null;
                const version = c.versions.find((v) => v.id === chosen) ?? c.versions[0]!;
                return (
                  <li key={c.key} className="grid gap-2 rounded-md border p-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id={`h-${c.key}`}
                        checked={!!chosen}
                        onCheckedChange={(on) => setPicked((p) => ({ ...p, [c.key]: on === true ? c.versions[0]!.id : null }))}
                      />
                      <Label htmlFor={`h-${c.key}`} className="grid gap-0.5 font-normal">
                        <span className="font-medium" dir="auto">
                          {version.title}
                        </span>
                        <span className="text-xs text-muted-foreground" dir="auto">
                          {c.projectTitle}
                        </span>
                      </Label>
                    </div>
                    {chosen && c.versions.length > 1 ? (
                      <NativeSelect
                        size="sm"
                        aria-label={t("versionField")}
                        value={chosen}
                        onChange={(e) => setPicked((p) => ({ ...p, [c.key]: e.target.value }))}
                      >
                        {c.versions.map((v) => (
                          <NativeSelectOption key={v.id} value={v.id}>
                            {t("versionOption", { n: v.version, date: format.dateTime(new Date(v.createdAt), { dateStyle: "medium" }) })}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {/* A hand-over never shares a file: one plain line names those still firm-only and points to their own Share action. */}
          {choices && firmOnly.length ? (
            <p className="text-xs text-muted-foreground" dir="auto">
              {t("firmOnlyFiles", { titles: firmOnly.map((f) => f.title).join(" · ") })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !choices?.length}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? tc("saving") : t("handOver")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

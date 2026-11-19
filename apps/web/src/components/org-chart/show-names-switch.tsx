"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { callApi } from "@/components/form-dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";

/**
 * The client's admin's switch on the current version (org chart, part 5;
 * part 1's rule): whether the company's managers see the names of the
 * people in positions, in their own department's part of the structure and
 * the chain above it. "Your manager" follows it too. Off until the admin
 * turns it on; a new version keeps the choice.
 */
export function ShowNamesSwitch({ versionId, on }: { versionId: string; on: boolean }) {
  const t = useTranslations("orgChart.showNames");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function change(next: boolean) {
    setBusy(true);
    const r = await callApi(`/api/org-chart/versions/${versionId}/show-names`, "POST", { on: next });
    setBusy(false);
    if (!r.ok) return void toast.error(tc(`errors.${r.error}` as "errors.generic"));
    toast.success(next ? t("turnedOn") : t("turnedOff"));
    router.refresh();
  }
  return (
    <div className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
      <Switch id="show-names" checked={on} disabled={busy} onCheckedChange={(v) => void change(v)} className="mt-0.5" />
      <label htmlFor="show-names" className="grid gap-0.5">
        <span className="font-medium">{t("label")}</span>
        <span className="text-muted-foreground">{on ? t("hintOn") : t("hintOff")}</span>
      </label>
    </div>
  );
}

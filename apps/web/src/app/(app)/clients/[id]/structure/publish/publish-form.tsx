"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { useOrgChartError } from "@/components/org-chart/holders-panel";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";

/**
 * The publishing screen's one form (org chart, part 5): the day the version
 * takes effect (changing it reloads what the page lists for that day), the
 * board resolution if there is one, and "Publish version N", asked once more
 * because a published version is never taken back. The server checks
 * everything again, with the draft the publisher saw.
 */
export function PublishForm(props: {
  clientId: string;
  draftId: string;
  number: number;
  effectiveOn: string;
  /** The first day allowed: today, or the current version's day when later (never back-dated). */
  earliest: string;
  today: string;
  resolutions: { id: string; title: string }[];
  base: string;
  disabled: boolean;
}) {
  const t = useTranslations("orgChart.publish");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const say = useOrgChartError();
  const [confirm, confirmDialog] = useConfirm();
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" });

  function pickDay(next: string | undefined) {
    if (!next || next === props.effectiveOn) return;
    router.replace(`${props.base}/publish?on=${encodeURIComponent(next)}`, { scroll: false });
  }

  async function submit() {
    setError(null);
    if (!(await confirm(t("confirm", { n: props.number, date: day(props.effectiveOn) })))) return;
    setBusy(true);
    const r = await callApi(`/api/clients/${props.clientId}/structure/publish`, "POST", {
      draftId: props.draftId,
      effectiveOn: props.effectiveOn,
      resolutionDocumentId: resolution || null,
    });
    setBusy(false);
    if (!r.ok) return setError(say(r));
    toast.success(t("done", { n: props.number }));
    router.push(props.base);
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="publish-on">{t("effective")}</Label>
        <DatePicker
          id="publish-on"
          value={props.effectiveOn}
          onChange={pickDay}
          placeholder={t("effective")}
          required
          disabled={{ before: new Date(`${props.earliest}T00:00:00Z`) }}
          className="w-fit"
        />
        <p className="text-xs text-muted-foreground">
          {props.earliest > props.today ? t("effectiveHintAfter", { date: day(props.earliest) }) : t("effectiveHint")}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="publish-resolution">{t("resolution")}</Label>
        <NativeSelect id="publish-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className="max-w-md">
          <NativeSelectOption value="">{t("noResolution")}</NativeSelectOption>
          {props.resolutions.map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {d.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{props.resolutions.length ? t("resolutionHint") : t("resolutionNone")}</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void submit()} disabled={busy || props.disabled}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : null}
          {busy ? tc("saving") : t("button", { n: props.number })}
        </Button>
        {props.disabled ? <span className="text-sm text-muted-foreground">{t("emptyDraft")}</span> : null}
      </div>
      {confirmDialog}
    </div>
  );
}

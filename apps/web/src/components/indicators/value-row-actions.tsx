"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { callApi } from "@/components/form-dialog";
import { IndicatorDialog, ValueDialog, type IndicatorValues } from "@/components/indicators/indicator-dialogs";
import { RowMenu, useRowCall } from "@/components/row-menu";
import { toast } from "@/components/ui/toast";
import type { IndicatorFrequency } from "@/lib/indicators";
import { valueRowPlan } from "@/lib/row-actions";

/**
 * One value of a business indicator (page audit U15, row 28): its two rare
 * steps, marking it checked (a firm person who did not enter it) and
 * correcting it, are in the row's menu instead of two buttons. The flags
 * come from the server (getIndicator()).
 */
export function ValueRowActions(props: {
  indicatorId: string;
  unit: string;
  frequency: IndicatorFrequency;
  onBehalf: boolean;
  /** The period as the table prints it, to name the row's menu. */
  periodText: string;
  value: { id: string; period: string; value: number };
  can: { check: boolean; correct: boolean };
}) {
  const t = useTranslations("indicators");
  const tc = useTranslations("common");
  const call = useRowCall();
  const inMenu = new Set<string>(valueRowPlan(props.can).menu);
  return (
    <div className="flex items-center justify-end">
      <RowMenu
        label={tc("moreFor", { name: props.periodText })}
        items={[
          {
            key: "check",
            label: t("check"),
            allowed: inMenu.has("check"),
            onSelect: () => void call({ endpoint: `/api/indicator-values/${props.value.id}/check` }),
          },
          {
            key: "correct",
            label: t("correct"),
            allowed: inMenu.has("correct"),
            dialog: (control) => (
              <ValueDialog
                indicatorId={props.indicatorId}
                unit={props.unit}
                frequency={props.frequency}
                periods={[]}
                correct={{ period: props.value.period, valueId: props.value.id, value: props.value.value }}
                onBehalf={props.onBehalf}
                control={control}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * The indicator page's rare actions, in one menu beside its one main button
 * ("Enter a value"): change it, switch it off or on, delete it, and stop or
 * restart its mail. Each item is offered only where the server says so.
 */
export function IndicatorPageMenu(props: {
  name: string;
  clientOrgId: string;
  indicator: IndicatorValues & { active: boolean };
  locked: boolean;
  departments: { id: string; nameAr: string; nameEn: string | null }[];
  can: { manage: boolean; delete: boolean };
  /** Where the page goes once the indicator is deleted. */
  back: string;
  /** Present when this person is told when the latest value moves away (they may mute it). */
  mail: { muted: boolean } | null;
}) {
  const t = useTranslations("indicators");
  const tc = useTranslations("common");
  const tMail = useTranslations("notifications.mail");
  const router = useRouter();
  const call = useRowCall();
  const k = props.indicator;
  const base = `/api/indicators/${k.id}`;

  async function remove() {
    const r = await callApi(base, "DELETE");
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    router.push(props.back);
  }

  return (
    <RowMenu
      label={tc("moreFor", { name: props.name })}
      className="size-8"
      items={[
        {
          key: "edit",
          label: t("edit"),
          allowed: props.can.manage,
          dialog: (control) => (
            <IndicatorDialog clientOrgId={props.clientOrgId} indicator={k} locked={props.locked} departments={props.departments} control={control} />
          ),
        },
        {
          key: "switchOff",
          label: t("switchOff"),
          allowed: props.can.manage && k.active,
          confirm: t("switchOffConfirm"),
          onSelect: () => void call({ endpoint: base, method: "PATCH", body: { active: false } }),
        },
        {
          key: "switchOn",
          label: t("switchOn"),
          allowed: props.can.manage && !k.active,
          onSelect: () => void call({ endpoint: base, method: "PATCH", body: { active: true } }),
        },
        {
          key: "mute",
          label: props.mail?.muted ? tMail("unmute") : tMail("mute"),
          allowed: props.mail !== null,
          onSelect: () =>
            void call({
              endpoint: `${base}/mute`,
              method: "PUT",
              body: { muted: !props.mail?.muted },
              done: props.mail?.muted ? tMail("indicatorUnmuted") : tMail("indicatorMutedDone"),
            }),
        },
        {
          key: "delete",
          label: t("delete"),
          allowed: props.can.manage && props.can.delete,
          destructive: true,
          confirm: t("deleteConfirm"),
          onSelect: () => void remove(),
        },
      ]}
    />
  );
}

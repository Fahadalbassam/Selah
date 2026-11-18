"use client";

import { useTranslations } from "next-intl";
import { FormDialog, type Field } from "@/components/form-dialog";
import { RowMenu, useRowCall, type RowMenuItem } from "@/components/row-menu";
import { CLOSURE_LIMITS } from "@/lib/closure";

/**
 * The project page's menu (⋯, page audit 4.3): the rare things that were
 * buttons in the header or a tab of their own. Edit the details, watch the
 * project, and, while there is no Closing tab, start closing (the firm) or ask
 * the firm to close (the client). Each is drawn only when the server said so;
 * the server and the database decide again.
 */
export function ProjectMenu(props: {
  projectId: string;
  /** The "Edit details" form, as the page built it for this project; null when the person may not edit. */
  edit: Field[] | null;
  /** Watching the project (the firm), or null when not offered. */
  watch: { on: boolean } | null;
  startClosing: boolean;
  askToClose: boolean;
}) {
  const t = useTranslations("projectPage.menu");
  const tPh = useTranslations("phases");
  const ts = useTranslations("staffing");
  const tClose = useTranslations("closure");
  const run = useRowCall();
  const base = `/api/projects/${props.projectId}`;

  const items: RowMenuItem[] = [
    {
      key: "edit",
      label: tPh("edit"),
      allowed: props.edit !== null,
      dialog: (control) => (
        <FormDialog control={control} title={tPh("edit")} endpoint={base} method="PATCH" sendEmptyAsNull fields={props.edit ?? []} submitLabel={tPh("save")} />
      ),
    },
    {
      key: "watch",
      label: props.watch?.on ? ts("unwatch") : ts("watch"),
      allowed: props.watch !== null,
      onSelect: () => void run({ endpoint: `${base}/watch`, method: "PUT", body: { on: !props.watch?.on } }),
    },
    {
      key: "startClosing",
      label: tClose("start"),
      allowed: props.startClosing,
      confirm: tClose("startConfirm"),
      onSelect: () => void run({ endpoint: `${base}/closure`, body: { step: "start" }, done: tClose("start") }),
    },
    {
      key: "askToClose",
      label: tClose("request.ask"),
      allowed: props.askToClose,
      dialog: (control) => (
        <FormDialog
          control={control}
          title={tClose("request.askTitle")}
          description={tClose("request.askHint")}
          endpoint={`${base}/closure/request`}
          fields={[{ name: "note", label: tClose("request.note"), type: "textarea", maxLength: CLOSURE_LIMITS.note }]}
          submitLabel={tClose("request.send")}
        />
      ),
    },
  ];
  return <RowMenu label={t("label")} items={items} />;
}

/**
 * The one rare action of a row on the People tab (page audit U15): take a
 * person off the project, from the row's menu, asked first.
 */
export function RemoveFromProject({ name, endpoint, confirm }: { name: string; endpoint: string; confirm: string }) {
  const t = useTranslations("projectPage.row");
  const run = useRowCall();
  return (
    <RowMenu
      label={t("more", { name })}
      items={[{ key: "remove", label: t("remove"), allowed: true, destructive: true, confirm, onSelect: () => void run({ endpoint, method: "DELETE" }) }]}
    />
  );
}

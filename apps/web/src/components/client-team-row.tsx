"use client";

import { useTranslations } from "next-intl";
import { FormDialog, type Field } from "@/components/form-dialog";
import { RowMenu, useRowCall } from "@/components/row-menu";
import { teamRowPlan } from "@/lib/row-actions";

/**
 * A consultant on the firm's client page (page audit U15): making them the
 * lead or the deputy, and taking them off the client's team, are in the
 * row's menu instead of three buttons. The flags come from the server
 * (getClientTeam()); the routes check them again.
 */
export function ClientTeamMenu(props: {
  clientId: string;
  member: { userId: string; name: string; isLead: boolean; isDeputy: boolean };
  can: { manage: boolean; setLead: boolean; setDeputy: boolean };
}) {
  const t = useTranslations("staffing");
  const tc = useTranslations("common");
  const call = useRowCall();
  const { member: m, can } = props;
  const base = `/api/clients/${props.clientId}`;
  const plan = teamRowPlan({
    makeLead: can.setLead && !m.isLead,
    makeDeputy: can.setDeputy && !m.isLead && !m.isDeputy,
    removeDeputy: can.setDeputy && !m.isLead && m.isDeputy,
    remove: can.manage && (!m.isLead || can.setLead) && (!m.isDeputy || can.setDeputy),
  });
  const inMenu = new Set<string>(plan.menu);
  return (
    <RowMenu
      label={tc("moreFor", { name: m.name })}
      items={[
        {
          key: "makeLead",
          label: t("makeLead"),
          allowed: inMenu.has("makeLead"),
          onSelect: () => void call({ endpoint: `${base}/lead`, method: "PUT", body: { userId: m.userId } }),
        },
        {
          key: "makeDeputy",
          label: t("makeDeputy"),
          allowed: inMenu.has("makeDeputy"),
          confirm: t("makeDeputyConfirm"),
          onSelect: () => void call({ endpoint: `${base}/deputy`, method: "PUT", body: { userId: m.userId } }),
        },
        {
          key: "removeDeputy",
          label: t("removeDeputy"),
          allowed: inMenu.has("removeDeputy"),
          confirm: t("removeDeputyConfirm"),
          onSelect: () => void call({ endpoint: `${base}/deputy`, method: "DELETE" }),
        },
        {
          key: "remove",
          label: t("remove"),
          allowed: inMenu.has("remove"),
          destructive: true,
          confirm: t("removeConfirm"),
          onSelect: () => void call({ endpoint: `${base}/consultants/${m.userId}`, method: "DELETE" }),
        },
      ]}
    />
  );
}

/** A client contact without an account: change or remove, in the row's menu. */
export function ContactMenu(props: { contact: { id: string; name: string }; fields: Field[]; canEdit: boolean }) {
  const t = useTranslations("clients.contacts");
  const tc = useTranslations("common");
  const call = useRowCall();
  const c = props.contact;
  return (
    <RowMenu
      label={tc("moreFor", { name: c.name })}
      items={[
        {
          key: "edit",
          label: t("edit"),
          allowed: props.canEdit,
          dialog: (control) => (
            <FormDialog
              control={control}
              title={t("editTitle")}
              endpoint={`/api/contacts/${c.id}`}
              method="PATCH"
              sendEmptyAsNull
              fields={props.fields}
              submitLabel={tc("save")}
            />
          ),
        },
        {
          key: "remove",
          label: t("remove"),
          allowed: props.canEdit,
          destructive: true,
          confirm: t("removeConfirm", { name: c.name }),
          onSelect: () => void call({ endpoint: `/api/contacts/${c.id}`, method: "DELETE" }),
        },
      ]}
    />
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { callApi } from "@/components/form-dialog";
import { RowMenu, useRowCall } from "@/components/row-menu";
import { toast } from "@/components/ui/toast";

/**
 * The client page's rare actions (page audit 4.4, screen standard): watching
 * the client and deleting a pitch or a client added by mistake are in the
 * page's ⋯ menu, not buttons in its header. The flags come from the server;
 * the routes check them again.
 */
export function ClientPageMenu(props: {
  clientId: string;
  name: string;
  watch: { can: boolean; on: boolean };
  /** Null when this person may not delete it now. */
  remove: { label: string; confirm: string } | null;
}) {
  const t = useTranslations("staffing");
  const tc = useTranslations("common");
  const router = useRouter();
  const call = useRowCall();
  const base = `/api/clients/${props.clientId}`;
  return (
    <RowMenu
      label={tc("moreFor", { name: props.name })}
      className="size-9"
      items={[
        {
          key: "watch",
          label: props.watch.on ? t("unwatch") : t("watch"),
          allowed: props.watch.can,
          onSelect: () => void call({ endpoint: `${base}/watch`, method: "PUT", body: { on: !props.watch.on } }),
        },
        {
          key: "delete",
          label: props.remove?.label ?? "",
          allowed: !!props.remove,
          destructive: true,
          confirm: props.remove?.confirm,
          onSelect: () =>
            void (async () => {
              const r = await callApi(base, "DELETE");
              if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
              router.push("/clients");
            })(),
        },
      ]}
    />
  );
}

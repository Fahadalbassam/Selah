import { getFormatter, getTranslations } from "next-intl/server";
import { FormDialog } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { PACK_RECEIPT_LIMITS } from "@/lib/offboarding";
import type { ExportPackRow } from "@/services/export-pack";
import { MakePackButton, PackDownloadButton } from "@/components/pack-buttons";

/**
 * The export packs of an archived client (J14.2, J14.4), for the firm admin on
 * the client page and for the client's admin on its leaving page: make one,
 * download it, and record the receipt once. The firm records a handover made
 * outside Selah; the client confirms receiving it.
 */
export async function ExportPacks({ clientId, packs, side, canMake }: { clientId: string; packs: ExportPackRow[]; side: "firm" | "client"; canMake: boolean }) {
  const t = await getTranslations("offboarding.pack");
  const format = await getFormatter();
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const size = (n: number) =>
    n < 1024 * 1024
      ? format.number(Math.max(n / 1024, 0.1), { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 })
      : format.number(n / (1024 * 1024), { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
  const base = `/api/clients/${clientId}/offboarding/packs`;
  const note = { name: "note", label: t("noteField"), type: "textarea" as const, maxLength: PACK_RECEIPT_LIMITS.note };

  return (
    <div className="space-y-3">
      {packs.length === 0 ? <p className="text-muted-foreground">{t("none")}</p> : null}
      <ul className="space-y-3">
        {packs.map((p) => (
          <li key={p.id} className="space-y-1.5 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.madeBy ? t("madeOn", { date: day(p.madeAt), name: p.madeBy }) : t("madeByFirm", { date: day(p.madeAt) })}</span>
              <ToneBadge tone={p.receiptAt ? "active" : "waiting"}>{p.receiptAt ? t("received") : t("awaiting")}</ToneBadge>
              <span className="ms-auto">
                <PackDownloadButton endpoint={`${base}/${p.id}`} />
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t("size", { files: p.fileCount, size: size(p.sizeBytes) })}</p>
            <p className="font-mono text-[11px] break-all text-muted-foreground" dir="ltr" title={t("checksum")}>
              {p.sha256}
            </p>
            {p.receiptAt ? (
              <p className="text-xs text-muted-foreground" dir="auto">
                {p.receivedByName
                  ? t("handedTo", { person: p.receivedByName, date: day(p.receiptAt), name: p.receiptBy ?? "" })
                  : t("receivedOn", { date: day(p.receiptAt), name: p.receiptBy ?? "" })}
                {p.receiptNote ? ` · ${p.receiptNote}` : ""}
              </p>
            ) : side === "client" ? (
              <FormDialog
                trigger={<Button size="sm">{t("confirm")}</Button>}
                title={t("confirmTitle")}
                description={t("confirmHint")}
                endpoint={`${base}/${p.id}/receipt`}
                fields={[note]}
                submitLabel={t("confirm")}
              />
            ) : (
              <FormDialog
                trigger={
                  <Button size="sm" variant="ghost">
                    {t("handover")}
                  </Button>
                }
                title={t("handoverTitle")}
                description={t("handoverHint")}
                endpoint={`${base}/${p.id}/receipt`}
                fields={[
                  {
                    name: "receivedBy",
                    label: t("receivedByField"),
                    required: true,
                    maxLength: PACK_RECEIPT_LIMITS.name.max,
                    placeholder: t("receivedByPlaceholder"),
                  },
                  note,
                ]}
                submitLabel={t("handover")}
              />
            )}
          </li>
        ))}
      </ul>
      {canMake ? <MakePackButton endpoint={base} /> : null}
    </div>
  );
}

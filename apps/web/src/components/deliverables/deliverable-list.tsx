import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { DownloadButton } from "@/app/(app)/actions/[id]/download-button";
import { FormDialog } from "@/components/form-dialog";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { firmToday } from "@/lib/dates";
import { DELIVERABLE_LIMITS, dayText, receiptText, roundStatus, type ReceiptStatus } from "@/lib/deliverables";
import { RECEIVED_VIA } from "@/lib/engagement";
import type { DeliverableView, HandoverRound } from "@/services/deliverables";
import { HandOverDialog } from "./hand-over-dialog";

/** Receipt is not verification, so it is never green (docs/ui-guidelines.md). */
const TONES: Record<ReceiptStatus, Tone> = { not_handed_over: "open", waiting: "waiting", received: "active", commented: "problem", no_answer: "neutral" };

export async function DeliverableStatus({ status }: { status: ReceiptStatus }) {
  const t = await getTranslations("deliverables");
  return <ToneBadge tone={TONES[status]}>{t(`status.${status}`)}</ToneBadge>;
}

/**
 * Deliverables with their status word, the latest hand-over and its files,
 * the action this reader may take (hand over, confirm receipt, comment, or
 * record the receipt for a client the firm runs), and the earlier rounds
 * underneath. Used on the engagement page and on a client person's home.
 * `firmRun` words the firm's hand-over for a client with no accounts; `extra`
 * adds a row control (the firm admin's Remove).
 */
export async function DeliverableList({
  deliverables,
  firmRun,
  showProject,
  extra,
}: {
  deliverables: DeliverableView[];
  firmRun: boolean;
  showProject?: boolean;
  extra?: (d: DeliverableView) => ReactNode;
}) {
  const [t, tText, tA, tE, format, locale] = await Promise.all([
    getTranslations("deliverables"),
    getTranslations("deliverables.text"),
    getTranslations("action"),
    getTranslations("engagements"),
    getFormatter(),
    getLocale(),
  ]);
  const day = dayText(locale);
  const due = (d: string) => format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  // One main action per card: the first confirm button is solid, the rest outline.
  const firstConfirm = deliverables.find((d) => d.can.confirm)?.id;

  const round = (r: HandoverRound, latest: boolean, closed: boolean) => {
    const status = roundStatus(r, latest, closed);
    return (
      <div className="space-y-1.5 rounded-md border p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">{t("round", { n: r.round })}</p>
        <p className="text-muted-foreground" dir="auto">
          {status === "replaced"
            ? `${tText("handedOver", { date: day(r.deliveredAt), name: r.deliveredBy ?? "—" })} · ${t("status.replaced")}`
            : receiptText(r, tText, day, closed)}
        </p>
        <ul className="space-y-1">
          {r.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {tText("file", { title: f.title, version: f.version })}
              </span>
              <DownloadButton documentId={f.id} label={tA("download")} unavailable={tA("errors.unavailable")} />
            </li>
          ))}
          {r.hiddenFiles ? <li className="text-xs text-muted-foreground">{tText("hiddenFiles", { n: r.hiddenFiles })}</li> : null}
        </ul>
      </div>
    );
  };

  return (
    <ul className="divide-y">
      {deliverables.map((d) => {
        const [latest, ...earlier] = d.rounds;
        return (
          <li key={d.id} className="space-y-3 py-3 text-sm">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium" dir="auto">
                  {d.title}
                </p>
                {d.acceptanceCriteria ? (
                  <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">
                    {d.acceptanceCriteria}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {[d.dueOn ? tE("dueOn", { date: due(d.dueOn) }) : tE("noDue"), showProject ? d.engagementTitle : null, d.projectTitle].filter(Boolean).join(" · ")}
                </p>
              </div>
              <DeliverableStatus status={d.status} />
            </div>
            {latest ? round(latest, latest.round === d.latestRound, d.closed) : null}
            {d.can.handOver || d.can.record || d.can.confirm || d.can.comment || extra ? (
              <div className="flex flex-wrap items-center gap-2">
                {d.can.confirm && latest ? (
                  <FormDialog
                    trigger={<Button size="sm" variant={d.id === firstConfirm ? "default" : "outline"}>{t("confirm")}</Button>}
                    title={t("confirmTitle")}
                    description={t("confirmHint")}
                    endpoint={`/api/deliverables/${d.id}/receipt`}
                    fields={[]}
                    extra={{ round: latest.round }}
                    submitLabel={t("confirm")}
                  />
                ) : null}
                {d.can.comment && latest ? (
                  <FormDialog
                    trigger={
                      <Button size="sm" variant="ghost">
                        {t("comment")}
                      </Button>
                    }
                    title={t("commentTitle")}
                    description={t("commentHint")}
                    endpoint={`/api/deliverables/${d.id}/comment`}
                    fields={[{ name: "comment", label: t("commentField"), type: "textarea", required: true, maxLength: DELIVERABLE_LIMITS.comment.max }]}
                    extra={{ round: latest.round }}
                    submitLabel={t("comment")}
                  />
                ) : null}
                {d.can.record && latest ? (
                  <FormDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        {t("record")}
                      </Button>
                    }
                    title={t("recordTitle")}
                    description={t("recordHint")}
                    endpoint={`/api/deliverables/${d.id}/receipt`}
                    fields={[
                      { name: "receivedBy", label: t("receivedByField"), required: true, maxLength: DELIVERABLE_LIMITS.name.max, placeholder: t("receivedByPlaceholder") },
                      {
                        name: "receivedVia",
                        label: t("receivedViaField"),
                        type: "select",
                        required: true,
                        options: RECEIVED_VIA.map((v) => ({ value: v, label: tA(`recordFor.vias.${v}`) })),
                      },
                      { name: "receivedOn", label: t("receivedOnField"), type: "date", required: true, defaultValue: firmToday() },
                    ]}
                    extra={{ round: latest.round }}
                    submitLabel={t("record")}
                  />
                ) : null}
                {d.can.handOver ? (
                  <HandOverDialog
                    deliverableId={d.id}
                    title={d.title}
                    firmRun={firmRun}
                    trigger={
                      <Button size="sm" variant="outline">
                        {latest ? t("handOverNew") : t("handOver")}
                      </Button>
                    }
                  />
                ) : null}
                {extra?.(d)}
              </div>
            ) : null}
            {earlier.length ? (
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{t("history", { n: earlier.length })}</summary>
                <div className="mt-2 space-y-2">{earlier.map((r) => <div key={r.id}>{round(r, false, d.closed)}</div>)}</div>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

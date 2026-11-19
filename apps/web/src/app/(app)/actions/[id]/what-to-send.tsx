"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { RequestRow } from "@/components/request-row";
import { RowMenu, useRowCall } from "@/components/row-menu";
import { SendFileButton } from "@/components/send-file-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { panelVoice } from "@/lib/engagement";
import { evidenceItemPlacement, labelKey, placementTone } from "@/lib/status-words";
import { json, ReasonDialog, RunButton, send } from "./action-panel";
import { DownloadButton } from "./download-button";
import { AddItem, type EvidenceItem } from "./follow-through-panels";
import { ActionSendFile } from "./send-file";

const patch = (body: unknown): RequestInit => ({ ...json(body), method: "PATCH" });

/**
 * "What to send" (page audit 4.5, block 4): the action's description, what
 * shows it is done, and the evidence list, as one block. Each item is the
 * shared request row (components/request-row.tsx, the same as a document
 * request): its one outline button is "Send a file" for the side asked and
 * "Accept" for the firm; not accepted, not needed and ask again are in its
 * menu. The page's one solid button is the next step's.
 */
export function WhatToSend(props: {
  actionId: string;
  description: ReactNode;
  requiredEvidence: string | null;
  items: EvidenceItem[];
  canManage: boolean;
  /** The viewer is firm staff: picks the hint, which shouldn't follow canManage (off once verified). */
  firmView: boolean;
  /** A client the firm runs (no accounts): the firm records what the client sends (N24). */
  firmRun: boolean;
  /** The reader may attach a file now. */
  canSubmit: boolean;
  /** The reader may send the action for review now (so the file dialog offers it). */
  canReview: boolean;
}) {
  const t = useTranslations("action.items");
  const ta = useTranslations("action");
  const tc = useTranslations("common");
  const tw = useTranslations("statusWords");
  const format = useFormatter();
  const router = useRouter();
  const call = useRowCall();
  const done = () => router.refresh();
  const voice = panelVoice(props.firmView, props.firmRun);
  // On a client the firm runs nobody at the client reads Selah: no "the client sees this".
  const run = voice === "FirmRun" ? "FirmRun" : "";
  const waiting = props.items.filter((i) => i.status === "open" || i.status === "rejected");
  if (!props.items.length && !props.canManage && !props.description && !props.requiredEvidence) return null;

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("titleClient")}</CardTitle>
          {props.items.length || props.canManage ? <CardDescription>{t(`hint${voice}`)}</CardDescription> : null}
        </div>
        {props.canManage ? <AddItem actionId={props.actionId} onDone={done} hint={t(`addHint${run}`)} /> : null}
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {props.description}
        {props.requiredEvidence ? (
          <div className="space-y-1 text-sm">
            <p className="text-xs text-muted-foreground">{ta("requiredEvidence")}</p>
            <p className="max-w-3xl whitespace-pre-line" dir="auto">
              {props.requiredEvidence}
            </p>
          </div>
        ) : null}
        {props.items.length === 0 && props.canManage ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
        {props.items.length ? (
          <ul className="divide-y rounded-xl border">
            {props.items.map((i) => {
              const answer = props.canSubmit && (i.status === "open" || i.status === "rejected");
              // The last item still waiting: sending its file can send the whole action for review.
              const last = waiting.length === 1 && waiting[0]!.id === i.id;
              return (
                <RequestRow
                  key={i.id}
                  title={i.title}
                  description={i.description}
                  state={{ label: tw(labelKey(evidenceItemPlacement(i.status), props.firmView ? "firm" : "client")), tone: placementTone(evidenceItemPlacement(i.status)) }}
                  facts={i.dueDate ? [t("due", { date: format.dateTime(new Date(i.dueDate), { dateStyle: "medium" }) })] : []}
                  note={
                    i.decisionNote && (i.status === "rejected" || i.status === "waived")
                      ? t(i.status === "rejected" ? "rejectedBecause" : "waivedBecause", { note: i.decisionNote })
                      : null
                  }
                  files={i.files.map((f) => ({
                    key: f.documentId,
                    node: (
                      <>
                        <span className="max-w-60 truncate">{f.title}</span>
                        <DownloadButton documentId={f.documentId} label={ta("download")} unavailable={ta("errors.unavailable")} />
                      </>
                    ),
                  }))}
                  main={
                    answer ? (
                      <ActionSendFile
                        actionId={props.actionId}
                        items={[]}
                        item={{ id: i.id, title: i.title }}
                        canReview={props.canReview}
                        defaultAfter={last ? "review" : "save"}
                        recordFor={voice === "FirmRun"}
                        firm={props.firmView}
                        title={t("answerTitle", { item: i.title })}
                        trigger={<SendFileButton />}
                      />
                    ) : props.canManage && i.status === "submitted" ? (
                      <RunButton
                        size="sm"
                        variant="outline"
                        label={t("accept")}
                        run={() => send(`/api/evidence-requests/${i.id}`, patch({ status: "accepted" }))}
                        onDone={done}
                      />
                    ) : null
                  }
                  menu={
                    props.canManage ? (
                      <RowMenu
                        label={tc("moreFor", { name: i.title })}
                        items={[
                          {
                            key: "reject",
                            label: t("reject"),
                            allowed: i.status === "submitted",
                            dialog: (control) => (
                              <ReasonDialog
                                control={control}
                                title={t("reject")}
                                hint={t(`rejectHint${run}`)}
                                run={(note) => send(`/api/evidence-requests/${i.id}`, patch({ status: "rejected", note }))}
                                onDone={done}
                              />
                            ),
                          },
                          {
                            key: "reopen",
                            label: t("reopen"),
                            allowed: i.status === "rejected",
                            onSelect: () => void call({ endpoint: `/api/evidence-requests/${i.id}`, method: "PATCH", body: { status: "open" } }),
                          },
                          {
                            key: "waive",
                            label: t("waive"),
                            allowed: i.status === "open" || i.status === "submitted" || i.status === "rejected",
                            dialog: (control) => (
                              <ReasonDialog
                                control={control}
                                title={t("waive")}
                                hint={t(`waiveHint${run}`)}
                                run={(note) => send(`/api/evidence-requests/${i.id}`, patch({ status: "waived", note }))}
                                onDone={done}
                              />
                            ),
                          },
                        ]}
                      />
                    ) : null
                  }
                />
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

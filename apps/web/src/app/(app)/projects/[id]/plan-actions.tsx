"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { CircleX } from "@/components/animate-ui/icons/circle-x";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { RotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { MorphTitle } from "@/components/morph";
import { StatusBadge } from "@/components/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/authz";
import type { PlanEvidence } from "@/services/queries";

export interface PlanActionRow {
  id: string;
  title: string;
  status: ActionStatus;
  dueDate: string | null;
  ownerName: string | null;
  overdue: boolean;
  /** Why it is on the chosen rule chip ("12 days late"), when a chip is chosen. */
  reasons?: { rule: "late" | "blocked" | "stale" | "slipped" | "churn" | "orphaned"; n: number | null }[];
}

/**
 * A recommendation's actions on Plan. Each row opens on demand to show the
 * files sent for it and the last review decision (page audit row 4d: what
 * the Trace tree drew, now where the action is). Only actions the reader
 * may open are listed (getProject), and only files they may open (planEvidence).
 */
export function PlanActions({ rows, evidence, client }: { rows: PlanActionRow[]; evidence: Record<string, PlanEvidence>; client: boolean }) {
  const t = useTranslations("table");
  const format = useFormatter();
  if (!rows.length) return <p className="text-sm text-muted-foreground">—</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((r) => (
        <Row key={r.id} row={r} evidence={evidence[r.id] ?? { evidence: [], review: null }} client={client} t={t} format={format} />
      ))}
    </ul>
  );
}

function Row({
  row: r,
  evidence,
  client,
  t,
  format,
}: {
  row: PlanActionRow;
  evidence: PlanEvidence;
  client: boolean;
  t: ReturnType<typeof useTranslations<"table">>;
  format: ReturnType<typeof useFormatter>;
}) {
  const tp = useTranslations("projectPage");
  const [open, setOpen] = useState(false);
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const review = evidence.review;
  const ReviewIcon = review?.outcome === "accept" ? CircleCheck : review?.outcome === "revise" ? RotateCcw : CircleX;
  return (
    <li className="px-4 py-2.5 text-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <CollapsibleTrigger
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={tp("evidence.show", { title: r.title })}
            title={tp("evidence.show", { title: r.title })}
          >
            <ChevronDown className={cn("size-4 transition-transform", !open && "ltr:-rotate-90 rtl:rotate-90")} aria-hidden />
          </CollapsibleTrigger>
          <Link href={`/actions/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
            <MorphTitle name={`action-${r.id}`} className="truncate" dir="auto">
              {r.title}
            </MorphTitle>
          </Link>
          <span className="w-36 truncate text-xs text-muted-foreground">{r.ownerName ?? t("unassigned")}</span>
          <span className={cn("w-32 text-xs tabular-nums", r.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
            {r.dueDate ? day(r.dueDate) : "—"}
            {r.overdue ? <span className="ms-1">({t("overdue")})</span> : null}
          </span>
          <StatusBadge status={r.status} reader={client ? "client" : "firm"} />
        </div>
        {r.reasons?.length ? (
          <p className="ms-9 mt-1 text-xs text-muted-foreground">
            {r.reasons.map((x) => tp(`rules.why.${x.rule}`, { n: x.n ?? 0 })).join(" · ")}
          </p>
        ) : null}
        <CollapsibleContent>
          <div className="ms-9 mt-2 space-y-2 border-s ps-3 text-xs">
            {evidence.evidence.length === 0 ? (
              <p className="text-muted-foreground">{tp("evidence.none")}</p>
            ) : (
              <ul className="space-y-1">
                {evidence.evidence.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <FileText className="size-3.5 text-muted-foreground" />
                    <a href={`/api/documents/${e.documentId}/download`} className="font-medium hover:underline" dir="auto">
                      {e.title}
                    </a>
                    <span className="text-muted-foreground tabular-nums">{tp("evidence.sent", { date: day(e.at) })}</span>
                    {e.recordedByFirm ? <span className="text-muted-foreground">· {tp(client ? "evidence.recordedClient" : "evidence.recorded")}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {review ? (
              <p className="flex items-center gap-2">
                <ReviewIcon className={cn("size-3.5", review.outcome === "accept" ? "text-success" : "text-destructive")} />
                {tp(`evidence.review.${review.outcome}`, { date: day(review.at) })}
              </p>
            ) : (
              <p className="text-muted-foreground">{tp("evidence.noReview")}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

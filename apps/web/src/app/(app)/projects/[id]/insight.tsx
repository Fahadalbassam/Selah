"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ActionStatus } from "@/authz";
import type { Reader } from "@/lib/status-words";

/**
 * What moved since this person last opened the project: one line above the
 * tabs ("8 actions moved since your last visit"), opened on demand (page
 * audit 4.3), so the tabs start near the top. The mark moves to now once shown.
 */
export function SinceLastVisit(props: {
  projectId: string;
  since: string | Date;
  firstVisit: boolean;
  changes: { actionId: string; title: string; status: string; changedAt: string | Date }[];
  reader: Reader;
}) {
  const t = useTranslations("insight");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void fetch(`/api/projects/${props.projectId}/since-last-visit`, { method: "PUT" });
  }, [props.projectId]);
  if (!props.changes.length) return null;
  const shown = all ? props.changes : props.changes.slice(0, 5);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="text-sm">
      <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
        {props.firstVisit
          ? t("since.firstTitle", { n: props.changes.length })
          : t("since.title", {
              n: props.changes.length,
              date: format.dateTime(new Date(props.since), { dateStyle: "medium" }),
            })}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 divide-y rounded-xl border bg-card px-4 shadow-xs">
          {shown.map((c) => (
            <li key={c.actionId} className="flex items-center gap-3 py-2">
              <Link href={`/actions/${c.actionId}`} className="min-w-0 flex-1 truncate hover:underline" dir="auto">
                {c.title}
              </Link>
              <StatusBadge status={c.status as ActionStatus} reader={props.reader} />
              {/* Server and browser clocks can straddle a minute: let the browser's text win. */}
              <span className="w-28 shrink-0 text-end text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                {format.relativeTime(new Date(c.changedAt), new Date())}
              </span>
            </li>
          ))}
        </ul>
        {props.changes.length > 5 ? (
          <button type="button" onClick={() => setAll(!all)} className="mt-2 text-muted-foreground hover:text-foreground">
            {all ? t("since.fewer") : t("since.more", { n: props.changes.length - 5 })}
          </button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

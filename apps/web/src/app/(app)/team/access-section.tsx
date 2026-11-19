"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * "Access" on People (October review, item 7): open invitations, the
 * allowed mail domains and the access review fold behind one line that says
 * what is inside, so the page leads with the people themselves.
 */
export function AccessSection({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <Collapsible className="rounded-xl border bg-card shadow-xs">
      <CollapsibleTrigger className="group flex w-full items-center gap-3 px-5 py-4 text-start focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">{title}</span>
          <span className="block text-sm text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 border-t p-4 lg:grid-cols-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

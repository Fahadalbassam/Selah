"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * The technical side of one audit entry (batch 5: the log in plain words):
 * the code name, the record, the address and the raw details, folded behind
 * "Details" under the sentence. Opened on demand, one entry at a time.
 */
export function EntryDetails({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible className="text-xs text-muted-foreground">
      <CollapsibleTrigger className="group flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        {label}
        <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-0.5 rounded-md bg-muted px-2.5 py-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

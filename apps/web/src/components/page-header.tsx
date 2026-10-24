import type { ReactNode } from "react";
import { MorphTitle } from "@/components/morph";

/**
 * The one page title block. `meta` holds badges that describe the page's
 * subject (kind, status, visibility) next to the title; `children` are the
 * page's actions and always sit together at the end of the row. `morph`
 * names the title for the page transition (components/morph.tsx), so the
 * card or row that opened the page morphs into it.
 */
export function PageHeader({
  title,
  description,
  meta,
  children,
  morph,
}: {
  title: string;
  morph?: string;
  description?: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {morph ? (
            <MorphTitle name={morph}>
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            </MorphTitle>
          ) : (
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          )}
          {meta}
        </div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

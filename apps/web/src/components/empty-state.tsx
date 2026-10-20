import type { ReactNode } from "react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/**
 * The one empty state for lists and panels (shadcn/ui Empty): a quiet icon,
 * one line, and an optional action. Pass an Animate UI icon with
 * animateOnView to have it play once as the panel appears.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title?: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("animate-page-in border bg-card/50 py-10 md:py-10", className)}>
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

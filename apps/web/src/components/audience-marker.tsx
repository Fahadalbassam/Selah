"use client";

import { useTranslations } from "next-intl";
import { EyeOff } from "@/components/animate-ui/icons/eye-off";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AudienceItemKind } from "@/lib/audience";
import { cn } from "@/lib/utils";

/**
 * "Limited audience" on an item whose audience was narrowed with the
 * `AudiencePicker`, for the people who can still see it. It never says who
 * was left out, or how many: they see nothing at all, not even this.
 */
export function AudienceMarker({ kind, className }: { kind: AudienceItemKind; className?: string }) {
  const t = useTranslations("audience.marker");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Focusable, so the explanation also opens from the keyboard. */}
        <Badge variant="outline" tabIndex={0} className={cn("gap-1 outline-none", className)} data-slot="audience-marker">
          <EyeOff className="size-3" aria-hidden />
          {t("label")}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{t("hint", { kind })}</TooltipContent>
    </Tooltip>
  );
}

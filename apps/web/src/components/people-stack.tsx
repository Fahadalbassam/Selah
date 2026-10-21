"use client";

import { AvatarGroup, AvatarGroupTooltip } from "@animate-ui/react/primitives/avatar-group";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

/**
 * Overlapping avatars for the people on a client or project (Animate UI
 * avatar group): hovering one lifts it and shows the name. Beyond `max`
 * the rest collapse into a "+n" chip.
 */
export function PeopleStack({ names, max = 4, empty }: { names: string[]; max?: number; empty: string }) {
  if (names.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="flex items-center">
      <AvatarGroup className="-space-x-2 rtl:space-x-reverse" sideOffset={8}>
        {shown.map((name) => (
          <Avatar key={name} className="size-7 border-2 border-card">
            <AvatarFallback className="bg-muted text-[10px] font-medium">{initials(name)}</AvatarFallback>
            <AvatarGroupTooltip className="z-50 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">{name}</AvatarGroupTooltip>
          </Avatar>
        ))}
      </AvatarGroup>
      {rest > 0 ? (
        <span className="ms-1 rounded-full border bg-muted px-1.5 text-[10px] leading-5 font-medium text-muted-foreground tabular-nums" title={names.slice(max).join(", ")}>
          +{rest}
        </span>
      ) : null}
    </div>
  );
}

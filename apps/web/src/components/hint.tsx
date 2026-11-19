"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A tooltip of one short sentence (big prompt 6.1): what a control will do,
 * or what a word means, never the label again. Only where the label alone
 * does not say it: icon-only buttons, status words, role chips, visibility
 * labels, "available to the assistant", second sign-off, risk acceptance,
 * the closing steps and the indicator data modes. Every text is a `tips.*`
 * message, in Arabic and English (tests/tips.test.ts).
 *
 * It opens on hover and on keyboard focus (Radix opens a tooltip when its
 * trigger takes the focus), follows the reading direction, and is read out
 * as the trigger's description. A control (`asChild`: a button or a link)
 * is its own trigger; anything else (a badge, a word) is wrapped in a
 * focusable span, so the keyboard reaches it too.
 *
 * Props it does not know (and a ref) go on to the trigger, so a Hint can sit
 * inside another trigger (a dialog's or a menu's `asChild`) around the button.
 */
export function Hint({
  tip,
  children,
  asChild = false,
  className,
  ...rest
}: Omit<ComponentProps<typeof TooltipTrigger>, "asChild" | "children"> & {
  tip: string;
  children: ReactNode;
  /** The child is itself focusable (a button, a link, a menu trigger): it becomes the trigger. */
  asChild?: boolean;
  className?: string;
}) {
  // Its own provider (as shadcn's tooltip does), so a Hint works wherever it is drawn, with the app's no-delay setting.
  return (
    <TooltipProvider delayDuration={0}>
    <Tooltip>
      <TooltipTrigger asChild {...rest} className={asChild ? className : undefined}>
        {asChild ? (
          children
        ) : (
          <span
            tabIndex={0}
            data-slot="hint"
            className={cn("inline-flex w-fit max-w-full rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}
          >
            {children}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tip}</TooltipContent>
    </Tooltip>
    </TooltipProvider>
  );
}

/** The icon-only buttons whose tooltip is a sentence of its own, under `tips.icons`. */
export const ICON_TIPS = ["moreMenu", "notifications", "welcomeDismiss", "removeAttendee", "removeComment", "chatArchive", "chatDelete", "askAbout"] as const;
export type IconTip = (typeof ICON_TIPS)[number];

/**
 * An icon-only button's tooltip (`tips.icons.*`): the button is the trigger.
 * It passes what an outer trigger gives it on to the button, so it sits
 * between a menu's or a dialog's `asChild` trigger and the button.
 */
export function IconTip({ name, children, ...rest }: Omit<ComponentProps<typeof Hint>, "tip" | "asChild"> & { name: IconTip }) {
  const t = useTranslations("tips.icons");
  return (
    <Hint asChild tip={t(name)} {...rest}>
      {children}
    </Hint>
  );
}

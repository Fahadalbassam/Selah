"use client";

import { AnimateUIProvider } from "@animate-ui/react/provider";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import type { ReactNode } from "react";
import { FormValidity, type ValidityMessages } from "@/components/form-validity";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

// The theme script only ever runs from the server's HTML, before the page
// paints. When the browser builds the page itself instead of taking over the
// server's HTML (Next does that for a page that answers notFound(), and React
// does it after a failed hydration), React creates this <script> without
// running it and logs "Encountered a script tag while rendering React
// component". Marked as a data block in the browser, it is created silently;
// the theme is applied there by the provider's own effect. The server still
// sends it as a normal script (the element opts out of attribute comparison).
const THEME_SCRIPT_PROPS = typeof window === "undefined" ? undefined : { type: "application/json" };

export function Providers({ dir, nonce, validity, closeLabel, children }: { dir: "rtl" | "ltr"; nonce?: string; validity: ValidityMessages; closeLabel: string; children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" nonce={nonce} defaultTheme="system" enableSystem disableTransitionOnChange scriptProps={THEME_SCRIPT_PROPS}>
      <Direction.Provider dir={dir}>
        {/* Every animation follows the OS "reduce motion" setting. */}
        <MotionConfig reducedMotion="user">
          <AnimateUIProvider reducedMotion="user">
            <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
            <FormValidity messages={validity} />
            {/* Animate UI toast (Base UI underneath), at the end side of the reading direction. */}
            <Toaster closeLabel={closeLabel} />
          </AnimateUIProvider>
        </MotionConfig>
      </Direction.Provider>
    </ThemeProvider>
  );
}

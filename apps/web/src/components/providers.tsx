"use client";

import { AnimateUIProvider } from "@animate-ui/react/provider";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import type { ReactNode } from "react";
import { FormValidity, type ValidityMessages } from "@/components/form-validity";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ dir, nonce, validity, closeLabel, children }: { dir: "rtl" | "ltr"; nonce?: string; validity: ValidityMessages; closeLabel: string; children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" nonce={nonce} defaultTheme="system" enableSystem disableTransitionOnChange>
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

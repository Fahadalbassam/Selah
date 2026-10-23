"use client";

import { AnimateUIProvider } from "@animate-ui/react/provider";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ dir, nonce, children }: { dir: "rtl" | "ltr"; nonce?: string; children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" nonce={nonce} defaultTheme="system" enableSystem disableTransitionOnChange>
      <Direction.Provider dir={dir}>
        {/* Every animation follows the OS "reduce motion" setting. */}
        <MotionConfig reducedMotion="user">
          <AnimateUIProvider reducedMotion="user">
            <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
            <Toaster dir={dir} position={dir === "rtl" ? "bottom-left" : "bottom-right"} />
          </AnimateUIProvider>
        </MotionConfig>
      </Direction.Provider>
    </ThemeProvider>
  );
}

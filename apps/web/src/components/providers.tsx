"use client";

import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ dir, children }: { dir: "rtl" | "ltr"; children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Direction.Provider dir={dir}>
        <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
      </Direction.Provider>
    </ThemeProvider>
  );
}

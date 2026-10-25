"use client";

import { ScrollProgress, ScrollProgressProvider } from "@animate-ui/react/primitives/scroll-progress";

/**
 * A thin bar along the top of a long document that fills from the reading
 * direction's start as the page scrolls (Animate UI Scroll Progress). For the
 * legal notices and other pages read top to bottom.
 */
export function ReadingProgress() {
  return (
    <ScrollProgressProvider global>
      <ScrollProgress className="fixed inset-x-0 top-0 z-50 h-0.5 bg-foreground" />
    </ScrollProgressProvider>
  );
}

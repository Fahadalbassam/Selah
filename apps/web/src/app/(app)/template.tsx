import type { ReactNode } from "react";

// The page transition lives in the layout (PageTransition), which keeps it
// mounted across pages; this template only sets the vertical rhythm.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

import type { ReactNode } from "react";

// A template (unlike a layout) remounts on every navigation, so each page
// fades up into place. The global reduced-motion rule turns this off.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="flex animate-page-in flex-col gap-6">{children}</div>;
}

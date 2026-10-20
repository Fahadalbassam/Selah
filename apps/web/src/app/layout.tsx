import type { ReactNode } from "react";

// Placeholder. The real shell (shadcn, Arabic RTL, two portals) is step 4.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

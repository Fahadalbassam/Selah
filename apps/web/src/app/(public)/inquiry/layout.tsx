import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

// The root layout hands client components no strings; this part of the app gets them all.
export default function Layout({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}

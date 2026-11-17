import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { signedOutMessages } from "@/i18n/signed-out-messages";
import { PublicFrame } from "../public-frame";

// The root layout hands client components no strings, and these pages' client
// components read none (src/i18n/signed-out-messages.ts). Never pass the whole
// catalogue here: anyone can read this page's source.
export default async function Layout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <PublicFrame>
      <NextIntlClientProvider messages={signedOutMessages(messages, "legal")}>{children}</NextIntlClientProvider>
    </PublicFrame>
  );
}

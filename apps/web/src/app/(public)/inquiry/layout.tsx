import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { signedOutMessages } from "@/i18n/signed-out-messages";
import { PublicFrame } from "../public-frame";

// The root layout hands client components no strings. The form gets its own
// namespace and nothing else (src/i18n/signed-out-messages.ts): anyone can
// read this page's source, so the firm's internal wording stays out of it.
export default async function Layout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <PublicFrame>
      <NextIntlClientProvider messages={signedOutMessages(messages, "inquiry")}>{children}</NextIntlClientProvider>
    </PublicFrame>
  );
}

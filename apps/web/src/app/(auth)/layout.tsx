import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { CornerLocaleToggle } from "@/components/corner-locale-toggle";
import { signedOutMessages } from "@/i18n/signed-out-messages";

// The root layout hands client components no strings. These pages get only
// the namespaces their forms read (src/i18n/signed-out-messages.ts), never
// the whole catalogue: a signed-out visitor can read the page source.
export default async function Layout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={signedOutMessages(messages, "auth")}>
      {/* Arabic is the default and the language is a cookie, so someone who
          arrives from a mail link needs the switch on every one of these pages. */}
      <div className="relative">
        <CornerLocaleToggle />
        {children}
      </div>
    </NextIntlClientProvider>
  );
}

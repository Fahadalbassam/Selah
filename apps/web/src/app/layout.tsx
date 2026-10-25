import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { ValidityMessages } from "@/components/form-validity";
import { Providers } from "@/components/providers";
import { direction, isLocale } from "@/i18n/config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: { default: t("name"), template: `%s · ${t("name")}` }, description: t("tagline") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // From src/proxy.ts: the theme script runs before the page, so it needs the nonce too.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const dir = isLocale(locale) ? direction(locale) : "rtl";
  const t = await getTranslations("common.validity");
  const tCommon = await getTranslations("common");
  // Raw: the {n} placeholders are filled in the browser from the field's own limits.
  const validity = Object.fromEntries(
    (["required", "choose", "email", "url", "format", "tooShort", "tooLong", "tooLow", "tooHigh"] as const).map((k) => [k, t.raw(k) as string]),
  ) as ValidityMessages;
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-svh font-sans">
        {/* No strings here: each part of the app hands its client components the
            strings they need, so the public upload page doesn't send the whole
            catalogue to an anonymous visitor (see (public)/upload). */}
        <NextIntlClientProvider messages={null}>
          <Providers dir={dir} nonce={nonce} validity={validity} closeLabel={tCommon("close")}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { direction, isLocale } from "@/i18n/config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: { default: t("name"), template: `%s · ${t("name")}` }, description: t("tagline") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const dir = isLocale(locale) ? direction(locale) : "rtl";
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-svh font-sans">
        <NextIntlClientProvider>
          <Providers dir={dir}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

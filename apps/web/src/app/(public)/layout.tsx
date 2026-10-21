import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LogIn } from "@/components/animate-ui/icons/log-in";
import { BrandWordmark } from "@/components/brand";
import { LocaleToggle } from "@/components/locale-toggle";
import { Button } from "@/components/ui/button";

// Pages anyone can open without an account: the inquiry form and its
// privacy notice. Same host as the app; the account decides where a
// signed-in person lands, so nothing here names a client.
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [t, tApp] = await Promise.all([getTranslations("inquiry"), getTranslations("app")]);
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <Link href="/inquiry" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <BrandWordmark label={tApp("name")} className="h-8" />
          </Link>
          <nav className="flex items-center gap-1">
            <LocaleToggle label={t("language")} />
            <Button asChild variant="outline" size="sm">
              <Link href="/sign-in">
                <LogIn animateOnHover className="rtl:-scale-x-100" />
                {t("signIn")}
              </Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="relative flex-1">{children}</main>
    </div>
  );
}

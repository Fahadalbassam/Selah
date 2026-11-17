import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LogIn } from "@/components/animate-ui/icons/log-in";
import { BrandWordmark } from "@/components/brand";
import { LocaleToggle } from "@/components/locale-toggle";
import { buttonVariants } from "@/components/ui/button-variants";

/**
 * The header and frame of the pages anyone can open without an account.
 * Same host as the app; the account decides where a signed-in person lands,
 * so nothing here names a client.
 *
 * `bare` is for the no-login upload page: the person it is sent to has no
 * account, and that page shows the requested item, the firm's name and the
 * file field, nothing else (ui-guidelines). So no sign-in button, and the
 * wordmark is not a link. The language switch stays.
 */
export async function PublicFrame({ bare = false, children }: { bare?: boolean; children: ReactNode }) {
  const [t, tApp] = await Promise.all([getTranslations("inquiry"), getTranslations("app")]);
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          {bare ? (
            <BrandWordmark label={tApp("name")} className="h-8" />
          ) : (
            <Link href="/inquiry" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <BrandWordmark label={tApp("name")} className="h-8" />
            </Link>
          )}
          <nav className="flex items-center gap-1">
            <LocaleToggle label={t("language")} />
            {bare ? null : (
              <Link href="/sign-in" data-slot="button" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <LogIn animateOnHover className="rtl:-scale-x-100" />
                {t("signIn")}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="relative flex-1">{children}</main>
    </div>
  );
}

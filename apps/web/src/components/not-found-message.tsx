import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button-variants";

/**
 * What a "Not found" page says, and the way back. `corner` is the language
 * switch, for the signed-out page only: inside the app the top bar has one.
 */
export function NotFoundMessage({ corner }: { corner?: ReactNode }) {
  const t = useTranslations("notFound");
  return (
    <div className="relative flex min-h-[60svh] flex-col items-center justify-center gap-3 p-6 text-center">
      {corner}
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      <Link href="/" data-slot="button" className={buttonVariants({ variant: "outline" })}>{t("back")}</Link>
    </div>
  );
}

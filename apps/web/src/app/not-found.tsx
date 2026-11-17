import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CornerLocaleToggle } from "@/components/corner-locale-toggle";
import { buttonVariants } from "@/components/ui/button-variants";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="relative flex min-h-[60svh] flex-col items-center justify-center gap-3 p-6 text-center">
      {/* No header here either: a signed-out reader who lands on this page in the wrong language can switch. */}
      <CornerLocaleToggle />
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      <Link href="/" data-slot="button" className={buttonVariants({ variant: "outline" })}>{t("back")}</Link>
    </div>
  );
}

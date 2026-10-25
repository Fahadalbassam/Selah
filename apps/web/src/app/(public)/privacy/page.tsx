import type { Metadata } from "next";
import { ReadingProgress } from "@/components/reading-progress";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "@/components/animate-ui/icons/arrow-left";
import { buttonVariants } from "@/components/ui/button-variants";
import { PRIVACY_NOTICE_VERSION } from "@/lib/intake";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("privacy"))("metaTitle") };
}

const SECTIONS = ["collect", "why", "who", "technical", "keep", "rights"] as const;

// The notice the inquiry form links to. Its version is sent with every
// inquiry, so bump PRIVACY_NOTICE_VERSION whenever this text changes.
export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  return (
    <article className="mx-auto max-w-2xl animate-page-in space-y-8 px-6 py-12">
      <ReadingProgress />
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("version", { version: PRIVACY_NOTICE_VERSION })}</p>
        <h1 className="text-2xl font-semibold text-balance">{t("title")}</h1>
        <p className="leading-relaxed text-muted-foreground">{t("intro")}</p>
      </header>
      <div className="stagger space-y-6">
        {SECTIONS.map((s) => (
          <section key={s} className="space-y-1.5">
            <h2 className="font-medium">{t(`${s}Title`)}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t(s)}</p>
          </section>
        ))}
      </div>
      <Link href="/inquiry" data-slot="button" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft animateOnHover className="rtl:-scale-x-100" />
          {t("back")}
        </Link>
    </article>
  );
}

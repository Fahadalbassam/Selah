import { getLocale, getTranslations } from "next-intl/server";
import { ClientHomeLists } from "@/components/home/client-home";
import { FirmHomeLists } from "@/components/home/firm-home";
import { OwnerHomeLists } from "@/components/home/owner-home";
import { PageHeader } from "@/components/page-header";
import { Welcome } from "@/components/welcome";
import { openSection } from "@/lib/home";
import { WELCOME_DAYS, welcomeFor } from "@/lib/welcome";
import { withPrincipal } from "@/server/page";
import { isNewcomer } from "@/services/consent";
import { home } from "@/services/home";
import { getViewer } from "@/services/queries";

/** The first name in the page's language: the other-language name when the stored one is in the other script. */
function firstName(v: { name: string; nameAlt: string | null }, locale: string) {
  const arabic = /[\u0600-\u06FF]/.test(v.name);
  const name = v.nameAlt && arabic !== (locale === "ar") ? v.nameAlt : v.name;
  return name.split(" ")[0] ?? name;
}

/**
 * The home, one per role (page audit 4.2; decision D2: Today became the
 * home, and /today sends here): what waits for the reader first, each row
 * with its next step, then how the work is going.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ all?: string | string[] }> }) {
  const open = openSection((await searchParams).all);
  const { page, viewer, isNew } = await withPrincipal(async (tx, principal) => ({
    page: await home(tx, principal),
    viewer: await getViewer(tx, principal),
    // New people (two weeks from their first sign-in) get a short welcome with three places to start.
    isNew: await isNewcomer(tx, principal, WELCOME_DAYS),
  }));
  const [t, tW, locale] = await Promise.all([getTranslations("home"), getTranslations("welcome"), getLocale()]);
  const side = viewer.orgKind === "firm" ? "firm" : "client";
  const [before, after] = tW.raw(`intro.${side}`).split("{highlight}") as [string, string];
  // The first-visit hints for this role (big prompt 6.1): what this home is for, then where to start.
  const hints = welcomeFor(viewer.role);
  const description =
    page.kind === "firm" ? t(page.data.admin ? "firm.followedNote" : "firm.description") : page.kind === "owner" ? t("owner.description") : t("client.description");

  return (
    <>
      <PageHeader title={t("title")} description={description} />
      {isNew ? (
        <Welcome
          greeting={tW("greeting", { name: firstName(viewer, locale) })}
          intro={[before, after]}
          highlight={tW(`highlight.${side}`)}
          purpose={tW(hints.home)}
          lead={tW("lead")}
          steps={(tW.raw(hints.steps) as { title: string; hint: string }[]).map((s, i) => ({ ...s, href: hints.links[i] ?? "/" }))}
          dismissLabel={tW("dismiss")}
          dir={locale === "ar" ? "rtl" : "ltr"}
        />
      ) : null}
      {page.kind === "firm" ? (
        <FirmHomeLists data={page.data} open={open} />
      ) : page.kind === "owner" ? (
        <OwnerHomeLists data={page.data} open={open} />
      ) : (
        <ClientHomeLists data={page.data} open={open} />
      )}
    </>
  );
}

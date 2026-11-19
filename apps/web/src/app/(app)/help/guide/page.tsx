import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { GuideView } from "@/components/guide-view";
import { PageHeader } from "@/components/page-header";
import { guideFor, parseGuide } from "@/lib/handbook";
import { withPrincipal } from "@/server/page";

/**
 * The reader's own part of the handbook (big prompt 6.2): the firm guide for
 * firm staff, the client guide for the client's people, never the other
 * part. It shows only what docs/handbook/ holds (copied into the app by
 * `npm run handbook:copy`); until that part is written the page is a 404,
 * like an address that does not exist. Reading a guide reads no data.
 */
export default async function GuidePage() {
  const role = await withPrincipal(async (_tx, principal) => principal.role);
  const locale = await getLocale();
  const guide = guideFor(role, locale);
  if (!guide) notFound();
  const t = await getTranslations("help.guide");
  const blocks = parseGuide(guide.text);
  // The guide's own first heading is the page's title.
  const first = blocks[0]?.kind === "heading" && blocks[0].level === 1 ? blocks[0] : null;
  const title = first ? first.text.map((p) => p.text).join("") : t(`title.${guide.part}`);
  return (
    <>
      <PageHeader title={title} description={t(`description.${guide.part}`)} />
      <GuideView blocks={first ? blocks.slice(1) : blocks} dir={guide.locale === "ar" ? "rtl" : "ltr"} />
    </>
  );
}

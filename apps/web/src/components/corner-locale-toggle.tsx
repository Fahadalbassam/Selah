import { getTranslations } from "next-intl/server";
import { LocaleToggle } from "@/components/locale-toggle";

/**
 * The language switch for pages with no header (sign-in, the pages mail
 * links open, consent, two-factor setup, Not found): the same control the
 * public pages have, in the top corner at the end of the reading direction.
 * It stays on the page it is on, so a token page keeps its token. The parent
 * must be positioned (`relative`).
 */
export async function CornerLocaleToggle() {
  const t = await getTranslations("header");
  return (
    <div className="absolute end-4 top-4 z-10">
      <LocaleToggle label={t("language")} title={t("switchLanguage")} />
    </div>
  );
}

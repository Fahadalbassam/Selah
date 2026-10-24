import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { withPrincipal } from "@/server/page";
import { pendingConsents } from "@/services/consent";
import { AuthShell } from "../auth-shell";
import { ConsentForm } from "./consent-form";

// The first sign-in (and the next one after a document changes): the terms of
// use, the privacy notice and the AI-use notice, each accepted on its own and
// recorded with its version (R1). Outside the app's layout, because nothing
// else opens until they are accepted.
export default async function ConsentPage() {
  const pending = await withPrincipal((tx) => pendingConsents(tx), { allowConsentPending: true });
  if (!pending.length) redirect("/");
  const t = await getTranslations("consent");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ConsentForm docs={pending.map((doc) => ({ doc, version: LEGAL_VERSIONS[doc] }))} />
    </AuthShell>
  );
}

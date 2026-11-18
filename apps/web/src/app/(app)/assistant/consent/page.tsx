import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { withPrincipal } from "@/server/page";
import { myClientAi } from "@/services/client-ai";
import { ClientAiConsent, WithdrawClientAi } from "../client-consent";

// What the notice says the assistant does; the people line is drawn on its own.
const AGREED = ["sees", "never", "rules", "stored"] as const;

/**
 * The client admin's consent view for the assistant (F39, page audit row 15),
 * "Assistant consent" in the user menu. Before consent it holds the firm's
 * offer and the agreement; after it, what was agreed, by whom and when, and
 * the switch to withdraw. Nobody else has it: the database lets only the
 * client's admin consent or withdraw (app_consent_client_ai).
 */
export default async function AssistantConsentPage() {
  const ai = await withPrincipal((tx, principal) => myClientAi(tx, principal));
  if (!ai || !(ai.canConsent || ai.canWithdraw)) notFound();
  const [tNav, t, tNotice, tA, tRole, format, locale] = await Promise.all([
    getTranslations("nav"),
    getTranslations("clientAi.consentView"),
    getTranslations("clientAi.notice"),
    getTranslations("assistant"),
    getTranslations("role"),
    getFormatter(),
    getLocale(),
  ]);
  const roles = ai.roles.map((r) => tRole(r));
  const list = roles.join(locale === "ar" ? "، " : ", ");
  return (
    <>
      <PageHeader title={tNav("assistantConsent")} description={t("hint")} />
      {ai.canConsent ? (
        <ClientAiConsent version={ai.version} roles={roles} />
      ) : ai.consent ? (
        <Card className="max-w-2xl gap-4 py-5 shadow-xs">
          <CardHeader className="space-y-1.5 px-5">
            <CardTitle className="text-base">{t("inForce")}</CardTitle>
            <CardDescription>
              {t("agreedBy", { name: ai.consent.givenBy ?? "—", date: format.dateTime(ai.consent.givenAt, { dateStyle: "long" }) })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 text-sm">
            <div className="space-y-1">
              <p>{tNotice("people", { roles: list })}</p>
              <p>{t("limit", { n: ai.dailyLimit })}</p>
              {/* Agreed, but the firm offered it to other roles than the admin's own. */}
              {ai.on ? null : <p className="text-muted-foreground">{tA("clientNotForYou", { roles: roles.join(" · ") })}</p>}
            </div>
            <div className="space-y-2">
              <h2 className="font-medium">{t("agreedTo")}</h2>
              <ul className="list-disc space-y-1.5 ps-5">
                {AGREED.map((k) => (
                  <li key={k}>{tNotice(k)}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">{tNotice("version", { version: ai.version })}</p>
          </CardContent>
          {ai.canWithdraw ? (
            <CardFooter className="px-5">
              <WithdrawClientAi />
            </CardFooter>
          ) : null}
        </Card>
      ) : (
        notFound()
      )}
    </>
  );
}

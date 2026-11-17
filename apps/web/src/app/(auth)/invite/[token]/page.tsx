import { getLocale, getTranslations } from "next-intl/server";
import { withAnonymous } from "@/server/page";
import { findInvitation } from "@/services/onboarding";
import { AuthShell } from "../../auth-shell";
import { DeadLink } from "../../dead-link";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, tRole, locale] = await Promise.all([getTranslations("account.invite"), getTranslations("role"), getLocale()]);
  // Reading the invitation changes nothing, so it is safe on every load.
  const invitation = await withAnonymous((tx) => findInvitation(tx, token));
  if (!invitation) {
    return <DeadLink title={t("invalidTitle")} body={t("invalid")} href="/sign-in" action={t("toSignIn")} />;
  }
  const org = locale === "ar" && invitation.orgNameAr ? invitation.orgNameAr : invitation.orgName;
  return (
    <AuthShell title={t("title", { org })} subtitle={t("subtitle", { role: tRole(invitation.role) })}>
      <AcceptForm token={token} email={invitation.email} name={invitation.name} />
    </AuthShell>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { BadRequestError } from "@/server/errors";
import { withAnonymous } from "@/server/page";
import { openInvitation } from "@/services/onboarding";
import { AuthShell } from "../../auth-shell";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, tRole, locale] = await Promise.all([getTranslations("account.invite"), getTranslations("role"), getLocale()]);
  const invitation = /^[A-Za-z0-9_-]{43}$/.test(token)
    ? await withAnonymous((tx) => openInvitation(tx, token)).catch((err) => {
        if (err instanceof BadRequestError) return null;
        throw err;
      })
    : null;
  if (!invitation) {
    return (
      <AuthShell title={t("invalidTitle")} subtitle={t("invalid")}>
        {null}
      </AuthShell>
    );
  }
  const org = locale === "ar" && invitation.orgNameAr ? invitation.orgNameAr : invitation.orgName;
  return (
    <AuthShell title={t("title", { org })} subtitle={t("subtitle", { role: tRole(invitation.role) })}>
      <AcceptForm token={token} email={invitation.email} name={invitation.name} />
    </AuthShell>
  );
}

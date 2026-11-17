import { getTranslations } from "next-intl/server";
import { withAnonymous } from "@/server/page";
import { emailChangeIsOpen } from "@/services/onboarding";
import { AuthShell } from "../../auth-shell";
import { DeadLink } from "../../dead-link";
import { ConfirmButton } from "./confirm-button";

// A button rather than confirming on load: mail scanners open links, and
// opening one must not switch the account over. What the page does on load is
// ask whether the link can still be confirmed (a read that changes nothing),
// so a dead one says so at once instead of after the press.
export default async function ConfirmEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("account.confirmEmail");
  if (!(await withAnonymous((tx) => emailChangeIsOpen(tx, token)))) {
    return <DeadLink title={t("deadTitle")} body={t("dead")} href="/sign-in" action={t("toSignIn")} />;
  }
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ConfirmButton token={token} />
    </AuthShell>
  );
}

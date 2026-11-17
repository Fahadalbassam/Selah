import { getTranslations } from "next-intl/server";
import { passwordResetIsOpen } from "@/auth/reset-links";
import { AuthShell } from "../../auth-shell";
import { DeadLink } from "../../dead-link";
import { ResetForm } from "./reset-form";

// The link is checked when the page loads (a read that uses nothing up), so
// a dead one says so before anyone types a new password twice.
export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("account.reset");
  if (!(await passwordResetIsOpen(token))) {
    return <DeadLink title={t("deadTitle")} body={t("dead")} href="/forgot-password" action={t("deadAction")} />;
  }
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ResetForm token={token} />
    </AuthShell>
  );
}

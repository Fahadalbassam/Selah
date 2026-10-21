import { getTranslations } from "next-intl/server";
import { AuthShell } from "../auth-shell";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("account.forgot");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ForgotForm />
    </AuthShell>
  );
}

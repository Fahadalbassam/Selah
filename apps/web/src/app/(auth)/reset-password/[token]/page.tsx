import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "../../auth-shell";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) notFound();
  const t = await getTranslations("account.reset");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ResetForm token={token} />
    </AuthShell>
  );
}

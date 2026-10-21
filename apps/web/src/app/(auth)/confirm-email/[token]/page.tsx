import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "../../auth-shell";
import { ConfirmButton } from "./confirm-button";

// A button rather than confirming on load: mail scanners open links, and
// opening one must not switch the account over.
export default async function ConfirmEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  const t = await getTranslations("account.confirmEmail");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ConfirmButton token={token} />
    </AuthShell>
  );
}

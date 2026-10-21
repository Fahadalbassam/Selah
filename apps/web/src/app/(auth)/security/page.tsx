import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TWO_FACTOR_ROLES } from "@/authz";
import { env } from "@/env";
import { currentUser, withPrincipal } from "@/server/page";
import { AuthShell } from "../auth-shell";
import { SecurityPanel } from "./security-panel";

// Two-factor sign-in: set up, new backup codes, or switch off when the role
// allows it. Outside the app's layout, because people who must set it up
// can open nothing else until they have.
export default async function SecurityPage() {
  const me = await currentUser();
  const role = await withPrincipal(async (_tx, principal) => principal.role, { allowTwoFactorSetup: true });
  const required = env().TWO_FACTOR_REQUIRED === "true" && TWO_FACTOR_ROLES.includes(role);
  const t = await getTranslations("security");
  return (
    <AuthShell title={t("title")} subtitle={me.twoFactorEnabled ? t("on") : required ? t("required") : t("optional")}>
      <SecurityPanel enabled={me.twoFactorEnabled} required={required} />
      {me.twoFactorEnabled || !required ? (
        <p className="text-center text-sm">
          <Link href="/" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t("back")}
          </Link>
        </p>
      ) : null}
    </AuthShell>
  );
}

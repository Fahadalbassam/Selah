import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LogIn } from "@/components/animate-ui/icons/log-in";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isSignInLinkToken, signInLinkVerifyPath } from "@/lib/sign-in-links";
import { AuthShell } from "../../../auth-shell";

/**
 * Where a sign-in link mail lands (F14). Opening this page uses nothing up:
 * mail scanners follow links, so the link is spent only when the person
 * presses the button. Nothing here says whose link it is.
 */
export default async function SignInLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("signIn.link");
  if (!isSignInLinkToken(token)) {
    return (
      <AuthShell title={t("invalidTitle")} subtitle={t("invalid")}>
        <p className="text-center text-sm">
          <Link href="/sign-in" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t("toSignIn")}
          </Link>
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t("pageTitle")} subtitle={t("pageSubtitle")}>
      <Card className="py-6 shadow-xs">
        <CardContent className="space-y-4 px-6">
          <Button asChild className="w-full">
            {/* A plain navigation: Better Auth sets the session cookie and redirects. */}
            <a href={signInLinkVerifyPath(token)} rel="nofollow">
              <LogIn animateOnHover className="rtl:-scale-x-100" />
              {t("continue")}
            </a>
          </Button>
          <p className="text-center text-xs text-muted-foreground">{t("once")}</p>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

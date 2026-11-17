import { getTranslations } from "next-intl/server";
import { LogIn } from "@/components/animate-ui/icons/log-in";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent } from "@/components/ui/card";
import { isSignInLinkToken, signInLinkVerifyPath } from "@/lib/sign-in-links";
import { AuthShell } from "../../../auth-shell";
import { DeadLink } from "../../../dead-link";

/**
 * Where a sign-in link mail lands (F14). Opening this page uses nothing up:
 * mail scanners follow links, so the link is spent only when the person
 * presses the button. Nothing here says whose link it is.
 */
export default async function SignInLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("signIn.link");
  if (!isSignInLinkToken(token)) {
    return <DeadLink title={t("invalidTitle")} body={t("invalid")} href="/sign-in" action={t("toSignIn")} />;
  }
  return (
    <AuthShell title={t("pageTitle")} subtitle={t("pageSubtitle")}>
      <Card className="py-6 shadow-xs">
        <CardContent className="space-y-4 px-6">
          {/* A plain navigation: Better Auth sets the session cookie and redirects.
              Styled as a button here, not wrapped in <Button asChild>: that button's
              slot renders nothing while the link it was handed is still arriving
              from the server, so the server's HTML and the browser's first render
              disagreed and the page failed to hydrate on every load. */}
          <a href={signInLinkVerifyPath(token)} rel="nofollow" data-slot="button" className={buttonVariants({ className: "w-full" })}>
            <LogIn animateOnHover className="rtl:-scale-x-100" />
            {t("continue")}
          </a>
          <p className="text-center text-xs text-muted-foreground">{t("once")}</p>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

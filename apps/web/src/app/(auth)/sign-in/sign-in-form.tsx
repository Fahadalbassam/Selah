"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Mail } from "lucide-react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { SIGN_IN_LINK_MINUTES } from "@/lib/sign-in-links";

export function SignInForm() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // "wrong" for a bad password or code, "limited" after too many tries.
  const [failed, setFailed] = useState<false | "wrong" | "limited">(false);
  // After the password: the code from the authenticator app, or a backup code.
  // "link" once a sign-in link was asked for.
  const [step, setStep] = useState<"password" | "totp" | "backup" | "link">("password");
  const emailRef = useRef<HTMLInputElement>(null);

  // A sign-in link (F14): only client managers and action owners get one, but
  // the answer is the same for every address.
  async function sendLink() {
    const input = emailRef.current;
    if (!input?.reportValidity()) return;
    setBusy(true);
    setFailed(false);
    const { error } = await authClient.signIn.magicLink({ email: input.value.trim(), callbackURL: "/" });
    setBusy(false);
    if (error?.status === 429) return setFailed("limited");
    setStep("link");
  }

  const done = () => {
    router.replace("/");
    router.refresh();
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setFailed(false);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (error) {
      // Same message for every failure, so it doesn't reveal which accounts exist.
      setFailed(error.status === 429 ? "limited" : "wrong");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("totp");
    done();
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s+/g, "");
    setBusy(true);
    setFailed(false);
    const { error } =
      step === "totp" ? await authClient.twoFactor.verifyTotp({ code }) : await authClient.twoFactor.verifyBackupCode({ code });
    setBusy(false);
    if (error) return setFailed(error.status === 429 ? "limited" : "wrong");
    done();
  }

  if (step === "link") {
    return (
      <Card className="py-6 shadow-xs">
        <CardContent className="space-y-4 px-6">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">{t("link.sentTitle")}</p>
              <p className="text-muted-foreground">{t("link.sent", { minutes: SIGN_IN_LINK_MINUTES })}</p>
            </div>
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={() => setStep("password")}>
            {t("link.back")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step !== "password") {
    return (
      <Card className="py-6 shadow-xs">
        <CardContent className="px-6">
          <form method="post" onSubmit={verify} className="space-y-4" key={step}>
            <div className="grid gap-2">
              <Label htmlFor="code">{step === "totp" ? t("code") : t("backupCode")}</Label>
              <p className="text-xs text-muted-foreground">{step === "totp" ? t("codeHint") : t("backupHint")}</p>
              <Input
                id="code"
                name="code"
                dir="ltr"
                autoFocus
                required
                autoComplete="one-time-code"
                {...(step === "totp"
                  ? { inputMode: "numeric" as const, pattern: "[0-9 ]{6,7}", maxLength: 7 }
                  : { maxLength: 32 })}
                className="text-center font-mono tracking-widest"
              />
            </div>
            {failed ? <p className="text-sm text-destructive">{t(failed === "limited" ? "limited" : "codeError")}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("verify")}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full text-muted-foreground"
              onClick={() => {
                setFailed(false);
                setStep(step === "totp" ? "backup" : "totp");
              }}
            >
              {step === "totp" ? t("useBackup") : t("useApp")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-6 shadow-xs">
      <CardContent className="px-6">
        {/* method="post": a submit before the page hydrates must not put the password in the URL. */}
        <form method="post" onSubmit={submit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input ref={emailRef} id="email" name="email" type="email" autoComplete="username" dir="ltr" required />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("password")}</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("forgot")}
              </Link>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
          </div>
          {failed ? <p className="text-sm text-destructive">{t(failed === "limited" ? "limited" : "error")}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {busy ? t("submitting") : t("submit")}
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            {t("link.or")}
            <Separator className="flex-1" />
          </div>
          <div className="grid gap-2">
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={sendLink}>
              <Mail />
              {t("link.send")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("link.who")}</p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

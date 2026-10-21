"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function SignInForm() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setFailed(false);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (error) {
      // Same message for every failure, so it doesn't reveal which accounts exist.
      setFailed(true);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <Card className="py-6 shadow-xs">
      <CardContent className="px-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="username" dir="ltr" required />
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
          {failed ? <p className="text-sm text-destructive">{t("error")}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {busy ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

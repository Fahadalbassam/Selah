"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function ForgotForm() {
  const t = useTranslations("account.forgot");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "sent" | "limited">("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setBusy(true);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    // The same answer whether or not the address has an account.
    setState(error?.status === 429 ? "limited" : "sent");
  }

  return (
    <Card className="py-6 shadow-xs">
      <CardContent className="space-y-4 px-6">
        {state === "sent" ? (
          <p className="text-sm">{t("sent")}</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" autoComplete="username" dir="ltr" required />
            </div>
            {state === "limited" ? <p className="text-sm text-destructive">{t("limited")}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("submit")}
            </Button>
          </form>
        )}
        <p className="text-center text-sm">
          <Link href="/sign-in" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t("back")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

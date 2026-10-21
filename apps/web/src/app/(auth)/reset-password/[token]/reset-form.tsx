"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { PasswordFields, readPassword } from "../../password-fields";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const read = readPassword(new FormData(e.currentTarget));
    if ("error" in read) return setError(t(`password.${read.error}`));
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: read.password, token });
    setBusy(false);
    if (error) return setError(error.status === 429 ? t("forgot.limited") : t("reset.invalid"));
    router.replace("/sign-in?done=reset");
  }

  return (
    <Card className="py-6 shadow-xs">
      <CardContent className="px-6">
        <form onSubmit={submit} className="space-y-4">
          <PasswordFields />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {t("reset.submit")}
          </Button>
          <p className="text-center text-sm">
            <Link
              href="/forgot-password"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("reset.again")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordFields, readPassword } from "../../password-fields";

export function AcceptForm({ token, email, name }: { token: string; email: string; name: string }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const read = readPassword(form);
    if ("error" in read) return setError(t(`password.${read.error}`));
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invite/${token}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: String(form.get("name")), password: read.password }),
    });
    setBusy(false);
    if (!res.ok) return setError(t("invite.failed"));
    router.replace("/sign-in?done=invited");
  }

  return (
    <Card className="py-6 shadow-xs">
      <CardContent className="px-6">
        <form method="post" onSubmit={submit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t("invite.email")}</Label>
            <Input id="email" value={email} dir="ltr" readOnly disabled />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">{t("invite.name")}</Label>
            <Input id="name" name="name" defaultValue={name} autoComplete="name" maxLength={120} required />
          </div>
          <PasswordFields />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {t("invite.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

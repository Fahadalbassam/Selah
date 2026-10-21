"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ConfirmButton({ token }: { token: string }) {
  const t = useTranslations("account.confirmEmail");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setBusy(true);
    const res = await fetch("/api/email-change/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setBusy(false);
    if (!res.ok) return setFailed(true);
    router.replace("/sign-in?done=email");
  }

  return (
    <Card className="py-6 shadow-xs">
      <CardContent className="space-y-4 px-6">
        {failed ? <p className="text-sm text-destructive">{t("invalid")}</p> : null}
        <Button className="w-full" onClick={confirm} disabled={busy || failed}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : null}
          {t("submit")}
        </Button>
      </CardContent>
    </Card>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

const NOTICE = ["sees", "never", "rules", "stored", "people", "withdraw"] as const;

/**
 * The client assistant's notice (wave 3, F39), for the client's admin once the
 * firm has offered it. Agreeing records who agreed, when and to which version;
 * nobody at the client uses the assistant before that.
 */
export function ClientAiConsent({ version, roles }: { version: string; roles: string[] }) {
  const t = useTranslations("clientAi.notice");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);

  async function agree() {
    setBusy(true);
    const r = await callApi("/api/assistant/consent", "POST", { version, locale });
    setBusy(false);
    if (!r.ok) return toast.error(tc(`errors.${r.error}`));
    toast.success(t("agreed"));
    router.refresh();
  }

  return (
    <Card className="max-w-2xl gap-4 py-5 shadow-xs">
      <CardHeader className="space-y-1.5 px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        <ul className="list-disc space-y-1.5 ps-5">
          {NOTICE.map((k) => (
            <li key={k}>{k === "people" ? t(k, { roles: roles.join(locale === "ar" ? "، " : ", ") }) : t(k)}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("version", { version })}</p>
        <label className="flex items-start gap-2">
          <Checkbox checked={read} onCheckedChange={(c) => setRead(c === true)} className="mt-0.5" />
          <span>{t("confirm")}</span>
        </label>
      </CardContent>
      <CardFooter className="px-5">
        <Button onClick={agree} disabled={!read || busy}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : null}
          {t("agree")}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The client's admin switches the assistant off for everyone at the client. The firm admin can offer it again. */
export function WithdrawClientAi() {
  const t = useTranslations("clientAi.notice");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();

  async function withdraw() {
    if (!(await confirm(t("withdrawConfirm")))) return;
    const r = await callApi("/api/assistant/consent", "DELETE");
    if (!r.ok) return toast.error(tc(`errors.${r.error}`));
    toast.success(t("withdrawn"));
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={withdraw}>
        {t("withdraw")}
      </Button>
      {confirmDialog}
    </>
  );
}

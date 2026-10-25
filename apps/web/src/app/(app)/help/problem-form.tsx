"use client";

import { Send } from "@/components/animate-ui/icons/send";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORT_LIMITS } from "@/lib/help";

/** The "Technical problem" door (F13): a short report that goes to the firm's admins. */
export function ProblemForm() {
  const t = useTranslations("help.problem");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"limit" | "generic" | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/help/problems", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return void setError(res?.status === 429 ? "limit" : "generic");
    setBody("");
    toast.success(t("sent"));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <Label htmlFor="help-problem">{t("label")}</Label>
      <Textarea
        id="help-problem"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        rows={4}
        maxLength={SUPPORT_LIMITS.body}
        dir="auto"
        placeholder={t("placeholder")}
        aria-invalid={error ? true : undefined}
        aria-describedby="help-problem-hint"
      />
      <p id="help-problem-hint" className="text-xs text-muted-foreground">
        {t("hint", { n: SUPPORT_LIMITS.perDay })}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`errors.${error}`, { n: SUPPORT_LIMITS.perDay })}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : <Send animateOnHover className="size-4 rtl:-scale-x-100" />}
          {busy ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}

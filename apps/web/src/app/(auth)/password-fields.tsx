"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A new password typed twice. Same rules as Better Auth: 12 to 128 characters. */
export function PasswordFields() {
  const t = useTranslations("account.password");
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="password">{t("new")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          minLength={12}
          maxLength={128}
          required
        />
        <p className="text-xs text-muted-foreground">{t("rule")}</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
    </>
  );
}

/** The password from the form, or the message key that says what's wrong. */
export function readPassword(form: FormData): { password: string } | { error: "mismatch" | "length" } {
  const password = String(form.get("password") ?? "");
  if (password.length < 12 || password.length > 128) return { error: "length" };
  if (password !== String(form.get("confirm") ?? "")) return { error: "mismatch" };
  return { password };
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Stage =
  | { kind: "idle" }
  | { kind: "scan"; qr: string; secret: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/** The secret in an otpauth:// link, for typing into an app by hand. */
const secretOf = (uri: string) => new URL(uri).searchParams.get("secret") ?? "";

export function SecurityPanel({ enabled, required }: { enabled: boolean; required: boolean }) {
  const t = useTranslations("security");
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(
    fn: () => Promise<{ data: T | null; error: { status?: number } | null }>,
    onOk: (data: T) => void | Promise<void>,
    failKey: string,
  ) {
    setBusy(true);
    setError(null);
    const { data, error } = await fn();
    setBusy(false);
    if (error || data === null) return setError(error?.status === 429 ? t("limited") : t(failKey));
    await onOk(data);
  }

  const password = (e: React.FormEvent<HTMLFormElement>) => String(new FormData(e.currentTarget).get("password"));

  // 1. Password, then the app's secret and backup codes (not yet active).
  const start = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return run(
      () => authClient.twoFactor.enable({ password: password(e) }),
      async (data) => {
        if (!("totpURI" in data) || !data.totpURI) return setError(t("wrongPassword"));
        const qr = await QRCode.toString(data.totpURI, { type: "svg", margin: 1 });
        setStage({ kind: "scan", qr, secret: secretOf(data.totpURI), backupCodes: data.backupCodes ?? [] });
      },
      "wrongPassword",
    );
  };

  // 2. A code from the app proves it works; only then is it switched on.
  const confirm = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (stage.kind !== "scan") return;
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s+/g, "");
    return run(
      () => authClient.twoFactor.verifyTotp({ code }),
      () => setStage({ kind: "codes", backupCodes: stage.backupCodes }),
      "wrongCode",
    );
  };

  const newCodes = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return run(
      () => authClient.twoFactor.generateBackupCodes({ password: password(e) }),
      (data) => setStage({ kind: "codes", backupCodes: data.backupCodes }),
      "wrongPassword",
    );
  };

  const switchOff = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return run(
      () => authClient.twoFactor.disable({ password: password(e) }),
      () => router.refresh(),
      "wrongPassword",
    );
  };

  const finish = () => {
    router.replace("/");
    router.refresh();
  };

  const passwordField = (
    <div className="grid gap-2">
      <Label htmlFor="password">{t("password")}</Label>
      <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
    </div>
  );
  const errorLine = error ? <p className="text-sm text-destructive">{error}</p> : null;
  const spinner = busy ? <BrandLoader tone="current" className="size-4" /> : null;

  return (
    <Card className="py-6 shadow-xs">
      <CardContent className="space-y-4 px-6">
        {stage.kind === "scan" ? (
          <form method="post" onSubmit={confirm} className="space-y-4">
            <p className="text-sm">{t("scan")}</p>
            <div
              className="mx-auto size-44 rounded-md bg-white p-2 [&_svg]:size-full"
              role="img"
              aria-label={t("qr")}
              dangerouslySetInnerHTML={{ __html: stage.qr }}
            />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("manual")}</p>
              <code className="block rounded-md bg-muted px-2 py-1.5 text-center font-mono text-xs break-all" dir="ltr">
                {stage.secret}
              </code>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="code">{t("code")}</Label>
              <Input
                id="code"
                name="code"
                dir="ltr"
                inputMode="numeric"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                autoComplete="one-time-code"
                required
                autoFocus
                className="text-center font-mono tracking-widest"
              />
            </div>
            {errorLine}
            <Button type="submit" className="w-full" disabled={busy}>
              {spinner}
              {t("confirm")}
            </Button>
          </form>
        ) : stage.kind === "codes" ? (
          <div className="space-y-4">
            <p className="text-sm">{t("codes")}</p>
            <ul className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm" dir="ltr">
              {stage.backupCodes.map((c) => (
                <li key={c} className="text-center">
                  {c}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void navigator.clipboard?.writeText(stage.backupCodes.join("\n"))}
            >
              {t("copy")}
            </Button>
            <Button className="w-full" onClick={finish}>
              {t("saved")}
            </Button>
          </div>
        ) : !enabled ? (
          <form method="post" onSubmit={start} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("intro")}</p>
            {passwordField}
            {errorLine}
            <Button type="submit" className="w-full" disabled={busy}>
              {spinner}
              {t("start")}
            </Button>
          </form>
        ) : (
          <>
            <form method="post" onSubmit={newCodes} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("newCodesHint")}</p>
              {passwordField}
              {errorLine}
              <Button type="submit" variant="outline" className="w-full" disabled={busy}>
                {spinner}
                {t("newCodes")}
              </Button>
            </form>
            {!required ? (
              <form method="post" onSubmit={switchOff} className="space-y-3 border-t pt-4">
                <p className="text-sm text-muted-foreground">{t("offHint")}</p>
                <div className="grid gap-2">
                  <Label htmlFor="off-password">{t("password")}</Label>
                  <Input id="off-password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
                </div>
                <Button type="submit" variant="destructive" className="w-full" disabled={busy}>
                  {t("off")}
                </Button>
              </form>
            ) : (
              <p className="border-t pt-4 text-xs text-muted-foreground">{t("lostPhone")}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

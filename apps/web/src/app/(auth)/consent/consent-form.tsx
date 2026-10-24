"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { LEGAL_SLUGS, type AcceptedDoc } from "@/lib/legal";

/**
 * One tick per document, each linking to its full text; continue once all are
 * ticked. Someone who doesn't accept signs out: nothing else opens.
 */
export function ConsentForm({ docs }: { docs: { doc: AcceptedDoc; version: string }[] }) {
  const t = useTranslations("consent");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [ticked, setTicked] = useState<Partial<Record<AcceptedDoc, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = docs.every((d) => ticked[d.doc]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!all) return;
    setBusy(true);
    setError(null);
    const r = await callApi("/api/consent", "POST", { ...Object.fromEntries(docs.map((d) => [d.doc, d.version])), locale });
    setBusy(false);
    if (!r.ok) return setError(r.error === "invalid" ? t("changed") : tc(`errors.${r.error}`));
    router.replace("/");
    router.refresh();
  }

  return (
    <Card className="py-6 shadow-xs">
      <form onSubmit={submit} className="contents">
        <CardContent className="grid gap-4 px-6">
          {docs.map(({ doc, version }) => (
            <div key={doc} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{t(`docs.${doc}.title`)}</p>
              <p className="text-sm text-muted-foreground">{t(`docs.${doc}.summary`)}</p>
              <Link
                href={`/legal/${LEGAL_SLUGS[doc]}`}
                target="_blank"
                className="inline-block text-sm font-medium underline underline-offset-4"
              >
                {t("read", { version })}
              </Link>
              <div className="flex items-start gap-2 pt-1">
                <Checkbox
                  id={`c-${doc}`}
                  checked={!!ticked[doc]}
                  onCheckedChange={(v) => setTicked((x) => ({ ...x, [doc]: v === true }))}
                />
                <Label htmlFor={`c-${doc}`} className="text-sm leading-snug font-normal">
                  {t(`docs.${doc}.accept`)}
                </Label>
              </div>
            </div>
          ))}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col gap-2 px-6">
          <Button type="submit" className="w-full" disabled={!all || busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {t("continue")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={async () => {
              await authClient.signOut();
              router.replace("/sign-in");
              router.refresh();
            }}
          >
            {t("signOut")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/app/actions";
import { Globe } from "@/components/animate-ui/icons/globe";
import { Button } from "@/components/ui/button";

/** Switches Arabic and English for visitors who aren't signed in. */
export function LocaleToggle({ label }: { label: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      lang={locale === "ar" ? "en" : "ar"}
      onClick={() =>
        startTransition(async () => {
          await setLocale(locale === "ar" ? "en" : "ar");
          router.refresh();
        })
      }
    >
      <Globe animateOnHover />
      {label}
    </Button>
  );
}

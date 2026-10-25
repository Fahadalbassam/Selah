"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/app/actions";
import { Globe } from "@/components/animate-ui/icons/globe";
import { Button } from "@/components/ui/button";

/**
 * Switches Arabic and English: for visitors who aren't signed in, and in the
 * app's top bar beside the theme toggle. Sets the selah_locale cookie and
 * re-renders the same page in the other language.
 */
export function LocaleToggle({ label, title }: { label: string; title?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      title={title}
      onClick={() =>
        startTransition(async () => {
          await setLocale(locale === "ar" ? "en" : "ar");
          router.refresh();
        })
      }
    >
      <Globe animateOnHover />
      {/* The label names the other language, in that language. */}
      <span lang={locale === "ar" ? "en" : "ar"}>{label}</span>
    </Button>
  );
}

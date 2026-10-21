"use client";

import { Effect, Effects } from "@animate-ui/react/primitives/effects/effect";
import { TypingText } from "@animate-ui/react/primitives/texts/typing";
import { useTranslations } from "next-intl";
import { MessageSquare } from "@/components/animate-ui/icons/message-square";
import { ShieldCheck } from "@/components/animate-ui/icons/shield-check";
import { UserRound } from "@/components/animate-ui/icons/user-round";

const STEPS = [
  { key: "next1", icon: ShieldCheck },
  { key: "next2", icon: MessageSquare },
  { key: "next3", icon: UserRound },
] as const;

/** The side panel: what the form is for and what happens after sending it. */
export function InquiryIntro() {
  const t = useTranslations("inquiry");
  return (
    <aside className="space-y-8 lg:sticky lg:top-28 lg:self-start">
      <Effect fade slide={{ direction: "up", offset: 12 }} className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="min-h-[2lh] text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
          {/* Typed in once; screen readers get the whole heading at once. */}
          <TypingText text={t("title")} duration={40} />
        </h1>
        <p className="max-w-md leading-relaxed text-muted-foreground">{t("lede")}</p>
      </Effect>
      <section className="space-y-4">
        <h2 className="text-sm font-medium">{t("nextTitle")}</h2>
        <ol className="grid gap-3 md:grid-cols-3 lg:grid-cols-1">
          <Effects fade slide={{ direction: "up", offset: 10 }} delay={250} holdDelay={90}>
            {STEPS.map(({ key, icon: Icon }, i) => (
              <li key={key} className="flex items-start gap-3 rounded-xl border bg-card/70 p-3.5 backdrop-blur-sm">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                  <Icon animateOnView animateOnHover className="size-4" />
                </span>
                <p className="text-sm leading-relaxed">
                  <span className="me-1.5 font-medium tabular-nums text-muted-foreground">{i + 1}.</span>
                  {t(key)}
                </p>
              </li>
            ))}
          </Effects>
        </ol>
      </section>
    </aside>
  );
}

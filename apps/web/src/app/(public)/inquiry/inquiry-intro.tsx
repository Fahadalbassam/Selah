"use client";

import { Effects } from "@animate-ui/react/primitives/effects/effect";
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
      {/* Plain text in the server's HTML, no entrance effect and no typing: the
          title is the one line that says what the page is, so it shows at once,
          before any script runs. */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance lg:text-4xl">{t("title")}</h1>
        <p className="max-w-md leading-relaxed text-muted-foreground">{t("lede")}</p>
      </div>
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

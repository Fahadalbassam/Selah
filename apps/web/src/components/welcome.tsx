"use client";

import { Blurs } from "@animate-ui/react/primitives/effects/blur";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { HighlightText } from "@animate-ui/react/primitives/texts/highlight";
import { TypingText, TypingTextCursor } from "@animate-ui/react/primitives/texts/typing";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowLeft } from "@/components/animate-ui/icons/arrow-left";
import { ArrowRight } from "@/components/animate-ui/icons/arrow-right";
import { X } from "@/components/animate-ui/icons/x";
import { Button } from "@/components/ui/button";

export type WelcomeStep = { title: string; hint: string; href: string };

const KEY = "selah.welcome.hidden";
const listeners = new Set<() => void>();
function hidden() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The first-weeks welcome on the overview: the greeting types itself, the line
 * under it highlights what Selah is for (Animate UI Typing Text and Highlight
 * Text), and three role-specific places to start blur into focus, with a
 * highlight that follows the pointer. Hidden in this browser once dismissed.
 */
export function Welcome({
  greeting,
  intro,
  highlight,
  lead,
  steps,
  dismissLabel,
  dir,
}: {
  greeting: string;
  intro: [string, string];
  highlight: string;
  lead: string;
  steps: WelcomeStep[];
  dismissLabel: string;
  dir: "rtl" | "ltr";
}) {
  const isHidden = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    hidden,
    () => false,
  );
  if (isHidden) return null;
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  return (
    <section className="relative overflow-hidden rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute end-3 top-3"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            // Storage blocked: it stays hidden until the page reloads.
          }
          listeners.forEach((fn) => fn());
        }}
      >
        <X animateOnHover />
      </Button>
      <h2 className="min-h-8 pe-10 text-2xl font-semibold tracking-tight">
        <TypingText text={greeting} duration={45} delay={200}>
          <TypingTextCursor className="ms-0.5 inline-block h-6 w-0.5 translate-y-1 bg-foreground" />
        </TypingText>
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {intro[0].trimEnd()}{" "}
        <HighlightText
          text={highlight}
          delay={900}
          className="rounded bg-[linear-gradient(var(--surface),var(--surface))] bg-no-repeat px-1 py-0.5 font-medium text-foreground"
        />
        {intro[1].trimStart()}
      </p>
      <p className="mt-5 text-xs font-medium text-muted-foreground">{lead}</p>
      <Highlight controlledItems hover mode="parent" className="rounded-lg bg-surface" transition={{ type: "spring", stiffness: 350, damping: 35 }}>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <Blurs holdDelay={90} delay={500}>
          {steps.map((s) => (
            <HighlightItem key={s.title} value={s.title}>
              <Link href={s.href} className="group relative z-1 flex h-full flex-col gap-1 rounded-lg border border-transparent p-3">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {s.title}
                  <Arrow className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="text-xs text-muted-foreground">{s.hint}</span>
              </Link>
            </HighlightItem>
          ))}
          </Blurs>
        </div>
      </Highlight>
    </section>
  );
}

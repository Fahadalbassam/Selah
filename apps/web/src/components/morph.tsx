"use client";

import { usePathname } from "next/navigation";
import * as React from "react";
import { PageTransitionShared } from "@/components/animate-ui/components/page-transition";
import { cn } from "@/lib/utils";

/*
 * Shared-element morphs between pages. A title on a list (a project card, a
 * client row) carries the same name as the page header it opens, and the page
 * transition morphs one into the other. Names are `<kind>-<id>`, so each one
 * appears at most once on a page; never put a morph on a value that repeats on
 * a page (the project column of an actions table), or the browser skips the
 * whole transition.
 *
 * Most detail pages show their loading skeleton first, so the title the person
 * clicked is remembered here and the skeleton's header shows it under the same
 * name: the title moves into place at once, and the page settles around it.
 */

type Pending = { name: string; text: string; path: string };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function capture(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target as Element | null;
  const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link) return;
  const el = (link.querySelector("[data-morph]") ?? link.closest("[data-morph]")) as HTMLElement | null;
  pending = el?.dataset.morph ? { name: el.dataset.morph, text: el.textContent ?? "", path: new URL(link.href).pathname } : null;
  listeners.forEach((fn) => fn());
}

/** Listens for clicks on morphing links. Mounted once, in the app layout. */
export function MorphCapture() {
  React.useEffect(() => {
    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, []);
  return null;
}

/** A title that morphs into (or out of) the matching title on the next page. */
export function MorphTitle({ name, className, children }: { name: string; className?: string; children: React.ReactNode }) {
  return (
    <PageTransitionShared name={name} data-morph={name} className={cn("w-fit max-w-full", className)}>
      {children}
    </PageTransitionShared>
  );
}

/** In a loading skeleton: the title the person just clicked, in the page title's place. */
export function PendingTitle({ fallback }: { fallback: React.ReactNode }) {
  const path = usePathname();
  const p = React.useSyncExternalStore(subscribe, () => pending, () => null);
  if (!p || p.path !== path) return fallback;
  return (
    <MorphTitle name={p.name}>
      <h1 className="text-xl font-semibold tracking-tight">{p.text}</h1>
    </MorphTitle>
  );
}

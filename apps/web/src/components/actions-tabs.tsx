import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/actions", key: "actions" },
  { href: "/review", key: "review" },
  { href: "/oversight", key: "oversight" },
] as const;

type Tab = (typeof TABS)[number];

/**
 * Firm side: the actions list, the review queue and oversight are one entry
 * in the sidebar and three tabs here. They are links between pages, styled
 * like the tab list, and each keeps its own address, so old links and
 * bookmarks still open the same page.
 */
export function ActionsTabs({ current, labels, label }: { current: Tab["href"]; labels: Record<Tab["key"], string>; label: string }) {
  return (
    <nav aria-label={label} // The look of the tab list (ui/tabs.tsx), which is a client module.
      className="-mb-2 inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={cn(
            "inline-flex h-full items-center justify-center rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:text-muted-foreground dark:hover:text-foreground",
            t.href === current && "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground",
          )}
        >
          {labels[t.key]}
        </Link>
      ))}
    </nav>
  );
}

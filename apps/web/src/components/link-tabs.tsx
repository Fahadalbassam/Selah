import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tabs that are links between pages, styled like the tab list (ui/tabs.tsx,
 * a client module). Each tab keeps its own address, so links and bookmarks
 * open the same page and nothing new goes in the sidebar: the Actions tabs,
 * the client page's tabs (Overview, Departments, Structure) and the client's
 * Departments and Structure.
 */
export function LinkTabs({ tabs, current, label }: { tabs: readonly { href: string; label: string }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="-mb-2 inline-flex h-9 w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg bg-muted p-[3px] text-muted-foreground">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={cn(
            "inline-flex h-full items-center justify-center rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:text-muted-foreground dark:hover:text-foreground",
            t.href === current && "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

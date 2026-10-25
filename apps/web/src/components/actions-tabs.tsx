"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { href: "/actions", key: "actions" },
  { href: "/review", key: "review" },
  { href: "/oversight", key: "oversight" },
] as const;

/**
 * Firm side: the actions list, the review queue and oversight are one entry
 * in the sidebar and three tabs here. Each tab keeps its own address, so old
 * links and bookmarks still open the same page.
 */
export function ActionsTabs({ labels, label }: { labels: Record<(typeof TABS)[number]["key"], string>; label: string }) {
  const pathname = usePathname();
  const current = TABS.find((t) => pathname === t.href)?.href ?? "/actions";
  return (
    <Tabs value={current} className="-mb-2">
      <TabsList aria-label={label}>
        {TABS.map((t) => (
          <TabsTrigger key={t.href} value={t.href} asChild>
            <Link href={t.href} aria-current={t.href === current ? "page" : undefined}>
              {labels[t.key]}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

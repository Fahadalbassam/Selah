import { LinkTabs } from "@/components/link-tabs";

const TABS = [
  { href: "/actions", key: "actions" },
  { href: "/review", key: "review" },
  { href: "/oversight", key: "oversight" },
] as const;

type Tab = (typeof TABS)[number];

/**
 * Firm side: the actions list, the review queue and oversight are one entry
 * in the sidebar and three tabs here. They are links between pages
 * (`LinkTabs`), and each keeps its own address, so old links and bookmarks
 * still open the same page.
 */
export function ActionsTabs({ current, labels, label }: { current: Tab["href"]; labels: Record<Tab["key"], string>; label: string }) {
  return <LinkTabs label={label} current={current} tabs={TABS.map((t) => ({ href: t.href, label: labels[t.key] }))} />;
}

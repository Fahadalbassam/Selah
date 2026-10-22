"use client";

import { Bell } from "@/components/animate-ui/icons/bell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface NotificationRow {
  id: string;
  kind: string;
  title: string | null;
  titleAr: string | null;
  href: string | null;
  readAt: string | Date | null;
  createdAt: string | Date;
}

/** One line per notification kind; unknown kinds still read sensibly. */
function useText() {
  const t = useTranslations("notifications");
  const ar = useLocale() === "ar";
  return (n: NotificationRow) => {
    const title = (ar ? n.titleAr : null) ?? n.title;
    if (!title) return t("gone");
    const [head, kind, step] = n.kind.split(".");
    const level = Number(step ?? 0);
    const key =
      head === "follow_up"
        ? kind === "due_soon"
          ? "follow_up_due_soon"
          : level >= 2
            ? "follow_up_escalated"
            : "follow_up_overdue"
        : n.kind.replace(/\./g, "_");
    return t.has(`kinds.${key}`) ? t(`kinds.${key}`, { title, level }) : t("kinds.other", { title });
  };
}

/** The list itself, shared by the header popover and the notifications page. */
export function NotificationList({ items, onOpen }: { items: NotificationRow[]; onOpen?: () => void }) {
  const t = useTranslations("notifications");
  const format = useFormatter();
  const router = useRouter();
  const text = useText();
  const [read, setRead] = useState<Set<string>>(new Set());

  async function open(n: NotificationRow) {
    if (!n.readAt && !read.has(n.id)) {
      setRead((s) => new Set(s).add(n.id));
      await callApi("/api/notifications/read", "POST", { ids: [n.id] });
    }
    onOpen?.();
    if (n.href) router.push(n.href);
    else router.refresh();
  }

  if (!items.length) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="divide-y">
      {items.map((n) => {
        const unread = !n.readAt && !read.has(n.id);
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => open(n)}
              className={cn(
                "flex w-full items-start gap-3 px-4 py-3 text-start text-sm hover:bg-muted/60",
                !n.href && "cursor-default",
              )}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-foreground" : "bg-transparent")} />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className={cn("block", unread ? "font-medium" : "text-muted-foreground")}>{text(n)}</span>
                {/* Server and browser clocks can straddle a minute: let the browser's text win. */}
                <span className="block text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                  {format.relativeTime(new Date(n.createdAt), new Date())}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Marks everything read and refreshes the page. */
export function MarkAllRead({ onDone }: { onDone?: () => void }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await callApi("/api/notifications/read", "POST", {});
        setBusy(false);
        onDone?.();
        router.refresh();
      }}
    >
      {busy ? <BrandLoader tone="current" className="size-4" /> : null}
      {t("markAll")}
    </Button>
  );
}

/** The bell in the header: the unread count, and the newest notifications when opened. */
export function NotificationBell({ unread }: { unread: number }) {
  const t = useTranslations("notifications");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [count, setCount] = useState(unread);
  // The server's count wins after each navigation or refresh.
  const [seen, setSeen] = useState(unread);
  if (seen !== unread) {
    setSeen(unread);
    setCount(unread);
  }

  async function load() {
    const r = await callApi("/api/notifications", "GET");
    if (r.ok) {
      const data = r.data as { items: NotificationRow[]; unread: number };
      setItems(data.items.slice(0, 10));
      setCount(data.unread);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8" aria-label={`${t("open")}: ${t("unread", { n: count })}`}>
          <Bell className="size-4" />
          {count > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background tabular-nums">
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <p className="text-sm font-medium">{t("title")}</p>
          {count > 0 ? <MarkAllRead onDone={() => void load()} /> : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items ? (
            <NotificationList items={items} onOpen={() => setOpen(false)} />
          ) : (
            <div className="flex justify-center py-6">
              <BrandLoader className="size-5" />
            </div>
          )}
        </div>
        <div className="border-t px-4 py-2 text-center">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("seeAll")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

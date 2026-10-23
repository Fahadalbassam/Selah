import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Previous and next links under a long list, with where the reader is in it. Hidden when it all fits on one page. */
export function ListPager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const t = useTranslations("pager");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  const link = (to: number, label: string, icon: ReactNode, end: boolean) =>
    to < 1 || to > pages ? (
      <span aria-disabled className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "pointer-events-none opacity-50")}>
        {end ? label : icon}
        {end ? icon : label}
      </span>
    ) : (
      <Link href={href(to)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        {end ? label : icon}
        {end ? icon : label}
      </Link>
    );
  return (
    <nav aria-label={t("label")} className="flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground tabular-nums">
        {t("showing", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}
      </p>
      <div className="flex items-center gap-2">
        {/* Chevrons point the way the page reads, so they flip in Arabic. */}
        {link(page - 1, t("previous"), <ChevronLeft className="size-4 rtl:rotate-180" />, false)}
        {link(page + 1, t("next"), <ChevronRight className="size-4 rtl:rotate-180" />, true)}
      </div>
    </nav>
  );
}

/** The page number from a `?page=` value: a whole number from 1, anything else is page 1. */
export function pageParam(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

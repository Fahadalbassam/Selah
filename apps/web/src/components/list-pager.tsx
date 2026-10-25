import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from "@/components/ui/pagination";

/** The page numbers to show: the first, the last, and the current one with its neighbours. */
function pageWindow(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | null)[] = [];
  [...keep].sort((a, b) => a - b).forEach((n, i, all) => {
    if (i > 0 && n - all[i - 1]! > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/**
 * Pages under a long list: where the reader is, previous and next, and the page
 * numbers (shadcn Pagination on Animate UI's primitive: the current-page
 * highlight slides to the page chosen). Hidden when it all fits on one page.
 */
export function ListPager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const t = useTranslations("pager");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground tabular-nums">
        {t("showing", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}
      </p>
      <Pagination aria-label={t("label")} className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            {page > 1 ? (
              <PaginationLink href={href(page - 1)} size="sm" className="gap-1 px-2.5">
                {/* Chevrons point the way the page reads, so they flip in Arabic. */}
                <ChevronLeft className="rtl:rotate-180" />
                {t("previous")}
              </PaginationLink>
            ) : null}
          </PaginationItem>
          {pageWindow(page, pages).map((n, i) =>
            n === null ? (
              <PaginationItem key={`gap-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={n}>
                <PaginationLink href={href(n)} isActive={n === page} size="icon-sm" className="tabular-nums">
                  {n}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            {page < pages ? (
              <PaginationLink href={href(page + 1)} size="sm" className="gap-1 px-2.5">
                {t("next")}
                <ChevronRight className="rtl:rotate-180" />
              </PaginationLink>
            ) : null}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

/** The page number from a `?page=` value: a whole number from 1, anything else is page 1. */
export function pageParam(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SectionHeader } from "@/components/section-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { HOME_ROWS, showAllHref, shown, type HomeSection as SectionKey } from "@/lib/home";
import { cn } from "@/lib/utils";

/**
 * One list on the home page (page audit 4.2): a titled section whose count is
 * the number of its rows, five rows at a time with "Show all", which opens
 * the same list in full on the same page (so the count and the list it opens
 * never disagree). Not drawn when it has no row.
 */
export async function HomeSection({
  id,
  title,
  description,
  rows,
  open,
  count,
  after,
}: {
  id: SectionKey;
  title: string;
  description?: ReactNode;
  rows: ReactNode[];
  /** The reader asked to see this one in full. */
  open: boolean;
  /** Shown beside the title in place of the plain number (it must still count these rows). */
  count?: string;
  /** A quiet line under the list (a link to the page that holds the rest of the work). */
  after?: ReactNode;
}) {
  if (!rows.length) return null;
  const t = await getTranslations("home");
  return (
    <section id={id} className="scroll-mt-16 space-y-3">
      <SectionHeader title={title} description={description}>
        <Badge variant="secondary" className="tabular-nums">
          {count ?? rows.length}
        </Badge>
      </SectionHeader>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">{shown(rows, open)}</ul>
      {!open && rows.length > HOME_ROWS ? (
        <Link href={showAllHref(id)} className="inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
          {t("showAll", { n: rows.length })}
        </Link>
      ) : null}
      {after}
    </section>
  );
}

/**
 * A row of a home list: what it is (a link to it), where it belongs, a few
 * facts, and its next step as one outline link ("Answer", "Send a file"):
 * a row never has a solid button of its own.
 */
export function HomeRow({
  href,
  title,
  sub,
  meta,
  step,
  stepHref,
  action,
}: {
  href: string;
  title: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  /** The next step's words; the link goes to `stepHref`, else to the row's own page. */
  step?: string;
  stepHref?: string;
  /** In place of a step link: a control that does the step here (marking a message handled). */
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-60 space-y-0.5">
        <Link href={href} className="block truncate text-sm font-medium hover:underline" dir="auto">
          {title}
        </Link>
        {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      {meta ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">{meta}</div> : null}
      {action ??
        (step ? (
          <Link href={stepHref ?? href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            {step}
          </Link>
        ) : null)}
    </li>
  );
}

/** "Project · Client" under a row's title, the client left out where the reader is the client. */
export function where(project: string, client?: string | null) {
  return client ? `${project} · ${client}` : project;
}

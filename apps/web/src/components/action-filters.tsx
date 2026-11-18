import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button-variants";
import { actionsHref, isRuleFilter, REVIEW_LONG_DAYS, type ActionFilterKey, type ActionsQuery } from "@/lib/action-filters";
import { cn } from "@/lib/utils";

/** A filter's name for this reader: a client reads "Waiting for the firm" where the firm reads "Awaiting review". */
export function useFilterName() {
  const t = useTranslations("actionsPage.filters");
  return (f: ActionFilterKey, firm: boolean) => (f === "awaiting-review" && !firm ? t("awaiting-review.nameClient") : t(`${f}.name`));
}

const chip = (active: boolean) => cn(buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }), "gap-1.5");

/**
 * The Actions lists as links (page audit 4.6): each keeps its address, so the
 * home and old links open it, and the chosen client, project, owner and
 * department stay as you switch. Each carries its count, the same number the
 * list holds. The rules follow after a line.
 */
export function ActionFilterLinks({ query, filters, counts, firm }: { query: ActionsQuery; filters: ActionFilterKey[]; counts: Partial<Record<ActionFilterKey, number>>; firm: boolean }) {
  const t = useTranslations("actionsPage");
  const name = useFilterName();
  const facets = { client: query.client, project: query.project, owner: query.owner, department: query.department };
  const link = (f: ActionFilterKey) => (
    <Link
      key={f}
      href={actionsHref({ ...facets, filter: f })}
      aria-current={query.filter === f ? "page" : undefined}
      title={f === "awaiting-review" && !firm ? t("filters.awaiting-review.hintClient") : t(`filters.${f}.hint`)}
      className={chip(query.filter === f)}
    >
      {name(f, firm)}
      <span className="text-muted-foreground tabular-nums">{counts[f] ?? 0}</span>
    </Link>
  );
  const lists = filters.filter((f) => !isRuleFilter(f));
  const rules = filters.filter(isRuleFilter);
  return (
    <nav aria-label={t("filtersLabel")} className="flex flex-wrap items-center gap-1">
      {lists.map(link)}
      <span aria-hidden className="mx-1 h-5 border-s" />
      {rules.map(link)}
    </nav>
  );
}

/** On "awaiting review": every waiting review, or only those past the review wait (Oversight's "reviews waiting" tile). */
export function WaitingLinks({ query, any, long }: { query: ActionsQuery; any: number; long: number }) {
  const t = useTranslations("actionsPage.waiting");
  const facets = { client: query.client, project: query.project, owner: query.owner, department: query.department, filter: query.filter };
  return (
    <nav aria-label={t("label")} className="-mt-3 flex flex-wrap items-center gap-1">
      <Link href={actionsHref(facets)} aria-current={!query.waitingLong ? "page" : undefined} className={chip(!query.waitingLong)}>
        {t("any")}
        <span className="text-muted-foreground tabular-nums">{any}</span>
      </Link>
      <Link href={actionsHref({ ...facets, waitingLong: true })} aria-current={query.waitingLong ? "page" : undefined} className={chip(query.waitingLong)}>
        {t("long", { days: REVIEW_LONG_DAYS })}
        <span className="text-muted-foreground tabular-nums">{long}</span>
      </Link>
    </nav>
  );
}

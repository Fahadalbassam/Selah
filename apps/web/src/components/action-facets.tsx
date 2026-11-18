"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PersonPicker } from "@/components/person-picker";
import { buttonVariants } from "@/components/ui/button-variants";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { actionsHref, type ActionsQuery } from "@/lib/action-filters";

const ALL = "all";

export interface FacetChoice {
  value: string;
  label: string;
  labelAr?: string | null;
}

type Facet = "client" | "project" | "owner" | "department";

/**
 * Narrow the Actions list by client (firm), project, owner and department
 * (October review, item 12). Each choice rewrites the address at once, so a
 * narrowed list survives a reload and can be linked; the choices are only
 * what the reader's own rows hold (the server sends them).
 */
export function ActionFacets({
  query,
  clients,
  projects,
  owners,
  departments,
}: {
  query: ActionsQuery;
  clients: FacetChoice[] | null;
  projects: FacetChoice[] | null;
  owners: FacetChoice[] | null;
  departments: FacetChoice[] | null;
}) {
  const t = useTranslations("actionsPage.facets");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const go = (k: Facet, value: string | undefined) => {
    const next: Partial<ActionsQuery> = { ...query, [k]: value, page: 1 };
    // A narrower client leaves a project of another client behind.
    if (k === "client") next.project = undefined;
    router.push(actionsHref(next));
  };
  const label = (o: FacetChoice) => (ar && o.labelAr ? o.labelAr : o.label);
  // A choice worth offering: more than one value, or one already chosen.
  const offered = (k: Facet, list: FacetChoice[] | null, min = 2): list is FacetChoice[] => !!list && (list.length >= min || !!query[k]);

  const select = (k: Facet, list: FacetChoice[], name: string, all: string) => (
    <div key={k} className="grid gap-1.5">
      <Label htmlFor={`facet-${k}`} className="text-xs text-muted-foreground">
        {name}
      </Label>
      <Select value={query[k] ?? ALL} onValueChange={(v) => go(k, v === ALL ? undefined : v)}>
        <SelectTrigger id={`facet-${k}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{all}</SelectItem>
          {list.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span dir="auto">{label(o)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const fields = [
    offered("client", clients) ? select("client", clients, t("client"), t("allClients")) : null,
    offered("project", projects) ? select("project", projects, t("project"), t("allProjects")) : null,
    offered("owner", owners) ? (
      <div key="owner" className="grid gap-1.5">
        <Label htmlFor="facet-owner" className="text-xs text-muted-foreground">
          {t("owner")}
        </Label>
        {/* Owners can run long: a picker you type into, like every pick of one person. */}
        <PersonPicker
          key={query.owner ?? ALL}
          id="facet-owner"
          options={owners.map((o) => ({ value: o.value, label: label(o) }))}
          defaultValue={query.owner}
          placeholder={t("allOwners")}
          clearable
          onValueChange={(v) => go("owner", v || undefined)}
        />
      </div>
    ) : null,
    offered("department", departments, 1) ? select("department", departments, t("department"), t("allDepartments")) : null,
  ].filter(Boolean);
  if (!fields.length) return null;
  const narrowed = !!(query.client || query.project || query.owner || query.department);
  return (
    <section aria-label={t("label")} className="flex flex-wrap items-end gap-3">
      <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{fields}</div>
      {narrowed ? (
        <Link href={actionsHref({ filter: query.filter, waitingLong: query.waitingLong })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t("clear")}
        </Link>
      ) : null}
    </section>
  );
}

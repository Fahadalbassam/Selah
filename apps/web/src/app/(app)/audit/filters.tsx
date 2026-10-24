"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AUDIT_AREAS, AUDIT_OUTCOMES } from "@/lib/audit";

const ALL = "all";

export interface AuditFilterValues {
  from?: string;
  to?: string;
  person?: string;
  area?: string;
  outcome?: string;
  org?: string;
}

/** The audit log's filters. Applying them rewrites the URL, so a filtered view survives a reload and can be shared. */
export function AuditFilters({
  initial,
  people,
  orgs,
}: {
  initial: AuditFilterValues;
  people: { id: string; label: string }[];
  /** Firm admin only: the firm and each client. */
  orgs: { id: string; label: string }[];
}) {
  const t = useTranslations("audit");
  const router = useRouter();
  const [v, setV] = useState<AuditFilterValues>(initial);
  const set = (k: keyof AuditFilterValues, value: string | undefined) => setV((x) => ({ ...x, [k]: value === ALL ? undefined : value }));

  function apply(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams(Object.entries(v).filter(([, x]) => x) as [string, string][]);
    router.push(q.size ? `/audit?${q}` : "/audit");
  }
  function reset() {
    setV({});
    router.push("/audit");
  }

  const choose = (id: string, label: string, k: keyof AuditFilterValues, items: { id: string; label: string }[]) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={v[k] ?? ALL} onValueChange={(x) => set(k, x)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Card className="py-4 shadow-xs">
      <CardContent className="px-5">
        <form onSubmit={apply} className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <div className="grid gap-2">
            <Label htmlFor="a-from">{t("filters.from")}</Label>
            <DatePicker id="a-from" value={v.from} onChange={(x) => set("from", x)} placeholder={t("filters.anyDay")} clearLabel={t("filters.clear")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-to">{t("filters.to")}</Label>
            <DatePicker id="a-to" value={v.to} onChange={(x) => set("to", x)} placeholder={t("filters.anyDay")} clearLabel={t("filters.clear")} />
          </div>
          {choose("a-person", t("filters.person"), "person", people)}
          {choose(
            "a-area",
            t("filters.area"),
            "area",
            Object.keys(AUDIT_AREAS).map((a) => ({ id: a, label: t(`areas.${a}` as "areas.files") })),
          )}
          {choose(
            "a-outcome",
            t("filters.outcome"),
            "outcome",
            AUDIT_OUTCOMES.map((o) => ({ id: o, label: t(`outcomes.${o}`) })),
          )}
          {orgs.length ? choose("a-org", t("filters.org"), "org", orgs) : null}
          <div className="flex items-end gap-2 md:col-span-3 lg:col-span-6 lg:justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              {t("filters.reset")}
            </Button>
            <Button type="submit" size="sm">
              {t("filters.apply")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ShieldCheck } from "@/components/animate-ui/icons/shield-check";
import { EmptyState } from "@/components/empty-state";
import { ExportButton } from "@/components/export-button";
import { ListPager, pageParam } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { ToneBadge } from "@/components/tone-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditActionKey, auditAreaOf, auditFiltersFrom } from "@/lib/audit";
import { withPrincipal } from "@/server/page";
import { auditChainStatus, listAuditEntries } from "@/services/audit-log";
import { AuditFilters } from "./filters";

type Search = Record<string, string | undefined>;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const filters = auditFiltersFrom(q);
  const page = pageParam(q.page);
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.role !== "firm_admin" && principal.role !== "client_admin") return null;
    return { log: await listAuditEntries(tx, principal, filters, page), chain: await auditChainStatus(tx, principal) };
  });
  if (!data) notFound();
  const [t, format, locale] = await Promise.all([getTranslations("audit"), getFormatter(), getLocale()]);
  const ar = locale === "ar";
  const { log, chain } = data;
  const label = (action: string) => {
    const key = `actions.${auditActionKey(action)}`;
    if (t.has(key)) return t(key as "actions.document_download");
    const area = auditAreaOf(action);
    return area ? t(`areas.${area}`) : action;
  };
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  const href = (p: number) => {
    const next = new URLSearchParams(query);
    if (p > 1) next.set("page", String(p));
    return next.size ? `/audit?${next}` : "/audit";
  };
  const people = log.people.map((p) => ({ id: p.id, label: p.name || p.email }));
  const orgs = log.orgs.map((o) => ({ id: o.id, label: o.firm ? t("filters.firm") : ((ar ? o.nameAr : null) ?? o.name) }));
  const tone = (o: string) => (o === "allow" ? "neutral" : "problem") as "neutral" | "problem";

  return (
    <>
      <PageHeader title={t("title")} description={log.firm ? t("description") : t("descriptionClient")}>
        <ExportButton endpoint={`/api/audit/export${query.size ? `?${query}` : ""}`} label={t("export")} />
      </PageHeader>

      {chain ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label={t("chain.lastCheck")}
              value={
                chain.checkedAt ? (
                  <ToneBadge tone={chain.ok ? "neutral" : "problem"} className="text-sm">
                    {chain.ok ? t("chain.intact") : t("chain.broken", { seq: chain.firstBadSeq ?? 0 })}
                  </ToneBadge>
                ) : (
                  <ToneBadge tone="waiting" className="text-sm">
                    {t("chain.notYet")}
                  </ToneBadge>
                )
              }
              hint={chain.checkedAt ? format.dateTime(chain.checkedAt, { dateStyle: "medium", timeStyle: "short" }) : t("chain.nightly")}
            />
            <StatTile label={t("chain.sealed")} value={format.number(chain.headSeq - chain.anchorSeq)} hint={t("chain.sealedHint")} />
            <StatTile
              label={t("chain.waiting")}
              value={format.number(chain.unsealed)}
              hint={t("chain.waitingHint")}
            />
            <StatTile
              label={t("chain.kept")}
              value={t("chain.months", { months: chain.keepMonths })}
              hint={chain.oldest ? t("chain.oldest", { date: format.dateTime(chain.oldest, { dateStyle: "medium" }) }) : t("chain.empty")}
            />
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>
              {t("chain.head", { seq: chain.headSeq })}{" "}
              <code dir="ltr" className="break-all font-mono text-xs text-foreground">
                {chain.headHash}
              </code>
            </span>
          </p>
        </>
      ) : null}

      <AuditFilters initial={filters} people={people} orgs={orgs} />

      {log.entries.length === 0 ? (
        <EmptyState icon={<ShieldCheck animateOnView />} description={query.size ? t("emptyFiltered") : t("empty")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("columns.time")}</TableHead>
                <TableHead>{t("columns.person")}</TableHead>
                <TableHead>{t("columns.action")}</TableHead>
                <TableHead>{t("columns.outcome")}</TableHead>
                <TableHead>{t("columns.details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm tabular-nums whitespace-nowrap text-muted-foreground">
                    {format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "medium" })}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{e.actorName ?? (e.actorId ? t("unknownPerson") : t("system"))}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.actorEmail ? <bdi dir="ltr">{e.actorEmail}</bdi> : null}
                      {e.actorEmail && e.actorOrg ? " · " : null}
                      {(ar ? e.actorOrgAr : null) ?? e.actorOrg}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{label(e.action)}</p>
                    <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
                      {e.action}
                    </p>
                  </TableCell>
                  <TableCell>
                    <ToneBadge tone={tone(e.outcome)}>{t(`outcomes.${e.outcome}`)}</ToneBadge>
                  </TableCell>
                  <TableCell className="max-w-80 text-xs whitespace-normal text-muted-foreground">
                    {e.resourceType ? (
                      <p>
                        {t("record")}: <span dir="ltr" className="font-mono">{e.resourceType}{e.resourceId ? ` ${e.resourceId.slice(0, 8)}` : ""}</span>
                      </p>
                    ) : null}
                    {e.reason ? <p>{t("reason")}: <bdi>{e.reason}</bdi></p> : null}
                    {e.ip ? (
                      <p>
                        {t("ip")}: <span dir="ltr" className="font-mono">{e.ip}</span>
                      </p>
                    ) : null}
                    {Object.keys(e.meta).length ? (
                      <p dir="ltr" className="text-start font-mono break-all">
                        {Object.entries(e.meta)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(" ")}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ListPager page={page} pageSize={50} total={log.total} href={href} />
    </>
  );
}

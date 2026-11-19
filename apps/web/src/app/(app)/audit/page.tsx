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
import { auditActionKey, auditAreaOf, auditFiltersFrom, auditLine } from "@/lib/audit";
import { withPrincipal } from "@/server/page";
import { auditChainStatus, listAuditEntries } from "@/services/audit-log";
import { AuditFilters } from "./filters";
import { EntryDetails } from "./entry-details";

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
  const [t, tStatus, format, locale] = await Promise.all([getTranslations("audit"), getTranslations("status"), getFormatter(), getLocale()]);
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
                <TableHead>{t("columns.entry")}</TableHead>
                <TableHead>{t("columns.outcome")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.entries.map((e) => {
                // One sentence a client admin understands (batch 5); the code name and the raw details behind "Details".
                const l = auditLine(e, (k) => t.has(`sentences.${k}`));
                const event =
                  l.event.kind === "sentence"
                    ? l.event.from && l.event.to
                      ? t(`sentences.${l.event.key}` as "sentences.action_transition", { from: tStatus(l.event.from as never), to: tStatus(l.event.to as never) })
                      : t(`sentences.${l.event.key}` as "sentences.auth_sign_in")
                    : label(e.action);
                const name = e.actorName ?? (e.actorId ? t("unknownPerson") : t("system"));
                return (
                  <TableRow key={e.id}>
                    <TableCell className="align-top text-sm tabular-nums whitespace-nowrap text-muted-foreground">
                      {format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "medium" })}
                    </TableCell>
                    <TableCell className="max-w-xl space-y-1 align-top whitespace-normal">
                      <p className="text-sm">{t.rich(l.line, { name, event, who: (c) => <span className="font-medium">{c}</span> })}</p>
                      {e.actorEmail || e.actorOrg ? (
                        <p className="text-xs text-muted-foreground">
                          {e.actorEmail ? <bdi dir="ltr">{e.actorEmail}</bdi> : null}
                          {e.actorEmail && e.actorOrg ? " · " : null}
                          {(ar ? e.actorOrgAr : null) ?? e.actorOrg}
                        </p>
                      ) : null}
                      {e.reason ? (
                        <p className="text-xs text-muted-foreground">
                          {t("reason")}: <bdi>{e.reason}</bdi>
                        </p>
                      ) : null}
                      <EntryDetails label={t("showDetails")}>
                        <p dir="ltr" className="text-start font-mono">
                          {e.action}
                        </p>
                        {e.resourceType ? (
                          <p>
                            {t("record")}:{" "}
                            <span dir="ltr" className="font-mono">
                              {e.resourceType}
                              {e.resourceId ? ` ${e.resourceId.slice(0, 8)}` : ""}
                            </span>
                          </p>
                        ) : null}
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
                      </EntryDetails>
                    </TableCell>
                    <TableCell className="align-top">
                      <ToneBadge tone={tone(e.outcome)}>{t(`outcomes.${e.outcome}`)}</ToneBadge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <ListPager page={page} pageSize={50} total={log.total} href={href} />
    </>
  );
}

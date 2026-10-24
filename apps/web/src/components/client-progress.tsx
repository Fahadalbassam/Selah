import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { Meter, StatTile } from "@/components/stat-tile";
import { ToneBadge } from "@/components/tone-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { localLabel } from "@/lib/names";
import type { ClientNumbers, ClientOverview } from "@/services/client-overview";

/**
 * A client's progress across its projects: the pooled total, with the same
 * numbers per project and per department right under it (F30).
 */
export async function ClientProgress({
  data,
  tiles = true,
  scope = "client",
}: {
  data: Pick<ClientOverview, "client" | "total" | "projects" | "departments">;
  /** Off where the page already shows these counts. */
  tiles?: boolean;
  /** A department's page shows its own numbers, without the client-wide report. */
  scope?: "client" | "department";
}) {
  const [t, tm, tPh, tExport] = await Promise.all([
    getTranslations("clientProgress"),
    getTranslations("metrics"),
    getTranslations("phases"),
    getTranslations("exports"),
  ]);
  const ar = (await getLocale()) === "ar";
  const { total } = data;
  const percent = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const applies = (n: ClientNumbers) => n.total - n.notApplicable - n.superseded;
  const columns = (n: ClientNumbers) => (
    <>
      <TableCell className="tabular-nums">{percent(n.implementedPct)}</TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{t("ofApplies", { verified: n.verified, applies: applies(n) })}</TableCell>
      <TableCell className="tabular-nums">{n.open}</TableCell>
      <TableCell className={n.overdue ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>{n.overdue}</TableCell>
    </>
  );
  const head = (first: string) => (
    <TableHeader>
      <TableRow>
        <TableHead className="w-[40%]">{first}</TableHead>
        <TableHead>{tm("implemented")}</TableHead>
        <TableHead>{t("verifiedCol")}</TableHead>
        <TableHead>{tm("outcome.open")}</TableHead>
        <TableHead>{tm("overdue")}</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{scope === "client" ? t("title") : t("departmentTitle")}</CardTitle>
          <CardDescription>{scope === "client" ? t("hint") : t("departmentHint")}</CardDescription>
        </div>
        {scope === "client" ? (
          <ExportButton endpoint={`/api/clients/${data.client.id}/report`} label={tExport("pdf")} title={t("downloadReport")} />
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5 px-5">
        <div className="space-y-3">
          <div className="space-y-2 rounded-xl border bg-card px-4 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-xs text-muted-foreground">{tm("implemented")}</p>
              <p className="text-3xl font-semibold tabular-nums">{percent(total.implementedPct)}</p>
            </div>
            {total.implementedPct === null ? (
              <p className="text-xs text-muted-foreground">{tm("noneYet")}</p>
            ) : (
              <>
                <Meter value={total.implementedPct} label={tm("implemented")} />
                <p className="text-xs text-muted-foreground">
                  {tm("implementedOf", { verified: total.verified, applies: applies(total) })}
                </p>
              </>
            )}
          </div>
          {tiles ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label={tm("outcome.open")} value={total.open} />
              <StatTile label={tm("overdue")} value={total.overdue} className={total.overdue ? "text-destructive" : undefined} />
              <StatTile label={tm("awaiting")} value={total.awaitingReview} />
              <StatTile label={tm("blocked")} value={total.blocked} />
            </div>
          ) : null}
        </div>

        {data.projects.length ? (
          // One table, so the department rows line up under the project rows.
          <Table className="table-fixed">
            {head(t("byProject"))}
            <TableBody>
              {data.projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline" dir="auto">
                        {p.sequence ? tPh("numbered", { n: p.sequence, title: p.title }) : p.title}
                      </Link>
                      {p.state === "active" ? null : (
                        <ToneBadge tone={p.state === "closed" ? "neutral" : "open"}>{tPh(`states.${p.state}`)}</ToneBadge>
                      )}
                    </span>
                  </TableCell>
                  {columns(p.numbers)}
                </TableRow>
              ))}
              {data.departments.length ? (
                <TableRow className="hover:bg-transparent">
                  <TableHead colSpan={5} className="h-auto pt-5 pb-2">
                    {t("byDepartment")}
                  </TableHead>
                </TableRow>
              ) : null}
              {data.departments.map((d) => (
                <TableRow key={d.id ?? "none"}>
                  <TableCell className={d.name ? "font-medium whitespace-normal" : "whitespace-normal text-muted-foreground"}>
                    {d.name && d.id ? (
                      <Link href={`/departments/${d.id}`} className="hover:underline">
                        {localLabel(d.name, ar)}
                      </Link>
                    ) : (
                      t("companyWide")
                    )}
                  </TableCell>
                  {columns(d.numbers)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("pooledNote")}</p>
      </CardContent>
    </Card>
  );
}

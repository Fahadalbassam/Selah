import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Meter, StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { localLabel, localName } from "@/lib/names";
import type { ClientNumbers } from "@/services/client-overview";
import type { GroupCompany } from "@/services/client-groups";

/**
 * A holding group's progress (F34): the counts of its member companies
 * pooled, whichever form each company takes, with a row per company. With
 * `links`, the firm side opens each company's own client or department
 * page (where its own access rules apply); the client side gets counts only.
 */
export async function GroupProgress({ total, companies, links }: { total: ClientNumbers; companies: GroupCompany[]; links: boolean }) {
  const [t, tm, tp] = await Promise.all([getTranslations("clientGroups"), getTranslations("metrics"), getTranslations("clientProgress")]);
  const ar = (await getLocale()) === "ar";
  const percent = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const applies = (n: ClientNumbers) => n.total - n.notApplicable - n.superseded;

  const name = (c: GroupCompany) => {
    const client = localName(c.client, ar);
    if (c.unit) {
      const label = localLabel(c.unit, ar);
      return links ? (
        <Link href={`/departments/${c.unit.id}`} className="font-medium hover:underline">
          {label}
        </Link>
      ) : (
        <span className="font-medium">{label}</span>
      );
    }
    const label = c.hasUnits ? t("ownWork", { client }) : client;
    return links ? (
      <Link href={`/clients/${c.client.id}`} className="font-medium hover:underline">
        {label}
      </Link>
    ) : (
      <span className="font-medium">{label}</span>
    );
  };

  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("pooledTitle")}</CardTitle>
        <CardDescription>{t("pooledHint")}</CardDescription>
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
                <p className="text-xs text-muted-foreground">{tm("implementedOf", { verified: total.verified, applies: applies(total) })}</p>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={tm("outcome.open")} value={total.open} />
            <StatTile label={tm("overdue")} value={total.overdue} className={total.overdue ? "text-destructive" : undefined} />
            <StatTile label={tm("awaiting")} value={total.awaitingReview} />
            <StatTile label={tm("blocked")} value={total.blocked} />
          </div>
        </div>

        {companies.length ? (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">{t("company")}</TableHead>
                <TableHead className="whitespace-normal">{t("form")}</TableHead>
                <TableHead className="whitespace-normal">{tm("implemented")}</TableHead>
                <TableHead className="whitespace-normal">{tp("verifiedCol")}</TableHead>
                <TableHead className="whitespace-normal">{tm("outcome.open")}</TableHead>
                <TableHead className="whitespace-normal">{tm("overdue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.unit?.id ?? c.client.id}>
                  <TableCell className="whitespace-normal">{name(c)}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {c.unit ? t("formUnit", { client: localName(c.client, ar) }) : t("formLinked")}
                  </TableCell>
                  <TableCell className="tabular-nums">{percent(c.numbers.implementedPct)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {tp("ofApplies", { verified: c.numbers.verified, applies: applies(c.numbers) })}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.numbers.open}</TableCell>
                  <TableCell className={c.numbers.overdue ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>{c.numbers.overdue}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("pooledNote")}</p>
      </CardContent>
    </Card>
  );
}

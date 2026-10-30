import { ArrowLeft, DatabaseZap, FileUp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { DataModePicker } from "@/components/indicators/data-mode-picker";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/ids";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { dataSettings } from "@/services/indicator-data";
import { FeedsCard } from "./feeds-card";
import { SourcesTable } from "./sources-table";

// How one client's indicator figures reach Selah: its choice (typed, files,
// connected), its connections, which indicators they fill and under what
// code, and every batch that came in. The client's admin decides; the firm
// sees it all and can suggest a choice.
export default async function IndicatorDataPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const data = await withPrincipal(async (tx, principal) => {
    const clientId = client && isUuid(client) ? client : principal.orgKind === "client" ? principal.orgId : null;
    if (!clientId) return null;
    return { firm: principal.orgKind === "firm", s: await dataSettings(tx, principal, clientId).catch(() => null) };
  });
  if (!data?.s) notFound();
  const { s, firm } = data;
  const [t, format, locale] = await Promise.all([getTranslations("indicatorData"), getFormatter(), getLocale()]);
  const ar = locale === "ar";
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const back = firm ? `/clients/${s.client.id}` : "/";
  const appUrl = process.env.APP_URL ?? "";

  return (
    <>
      <Link href={back} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {firm ? localName(s.client, ar) : t("back")}
      </Link>
      <PageHeader title={t("title")} description={firm ? localName(s.client, ar) : t("description")}>
        {s.canImport ? (
          <Link href={`/indicators/import?client=${s.client.id}`} data-slot="button" className={buttonVariants({ size: "sm" })}>
            <FileUp />
            {t("import")}
          </Link>
        ) : null}
      </PageHeader>

      <Card className="gap-4 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseZap className="size-4 text-muted-foreground" />
            {t("modeTitle")}
          </CardTitle>
          <CardDescription>
            {s.chosen && s.decidedAt ? t("decided", { name: s.decidedBy ?? "—", when: when(s.decidedAt) }) : t("notChosen")}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <DataModePicker
            clientId={s.client.id}
            mode={s.mode}
            chosen={s.chosen}
            proposal={s.proposal ? { mode: s.proposal.mode, by: s.proposal.by } : null}
            canChoose={s.canChoose}
            canPropose={s.canPropose && !s.canChoose}
          />
        </CardContent>
      </Card>

      {s.mode === "connected" && s.canManage ? (
        <FeedsCard
          clientId={s.client.id}
          feeds={s.feeds.map((f) => ({ ...f, createdAt: f.createdAt.toISOString(), lastRunAt: f.lastRunAt?.toISOString() ?? null, lastOkAt: f.lastOkAt?.toISOString() ?? null }))}
          canConnect={s.canConnect}
          endpoint={`${appUrl}/api/indicator-feed`}
          extraHosts={s.extraHosts}
        />
      ) : null}

      {s.canManage && s.indicators.length && s.mode !== "typed" ? (
        <SourcesTable indicators={s.indicators} connected={s.mode === "connected"} canChooseFlow={s.canChoose} />
      ) : null}

      <Card className="gap-4 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("batches.title")}</CardTitle>
          <CardDescription>{t("batches.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          {s.imports.length ? (
            <ul className="divide-y text-sm">
              {s.imports.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <Badge variant="outline">{t(`channels.${b.channel}`)}</Badge>
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {b.fileName ?? b.feedLabel ?? "—"}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{t("batches.counts", { added: b.added, corrected: b.corrected })}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.by}
                    {b.onBehalf ? ` · ${t("batches.onBehalf")}` : ""} · {when(b.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("batches.empty")}</p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("claimNote")}</p>
    </>
  );
}

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withPrincipal } from "@/server/page";
import { compareAssessments } from "@/services/assessments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  if (!a || !b || !UUID.test(a) || !UUID.test(b)) notFound();
  const data = await withPrincipal(async (tx, principal) => ({
    out: await compareAssessments(tx, principal, a, b),
    firm: principal.orgKind === "firm",
  }));
  const [t, tv, format] = await Promise.all([
    getTranslations("assessment.compare"),
    getTranslations("assessment.values"),
    getFormatter(),
  ]);
  const ar = (await getLocale()) === "ar";
  const { out, firm } = data;
  const value = (v: string | null | undefined) =>
    v === null || v === undefined ? "—" : ["yes", "partly", "no", "na"].includes(v) ? tv(v as "yes") : v;
  const pct = (earned: number | null, possible: number | null) =>
    earned === null || !possible ? "—" : `${format.number((100 * earned) / possible, { maximumFractionDigits: 1 })}%`;
  const day = (d: Date) => format.dateTime(d, { dateStyle: "medium" });

  return (
    <>
      <Link
        href={`/assessments/${out.later.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {out.later.title}
      </Link>
      <PageHeader title={t("title")} description={t("hint")} />

      <div className="grid gap-4 sm:grid-cols-2">
        {(["earlier", "later"] as const).map((side) => {
          const x = out[side];
          return (
            <Card key={side} className="gap-2 py-5 shadow-xs">
              <CardHeader className="px-5">
                <p className="text-xs text-muted-foreground">{t(side)}</p>
                <CardTitle className="text-base">
                  <Link href={`/assessments/${x.id}`} className="hover:underline">
                    {x.title}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 px-5 text-sm">
                <p className="text-muted-foreground">
                  {day(x.createdAt)} · {t(`status.${x.status}`)}
                </p>
                {firm && x.earned !== null ? (
                  <p className="tabular-nums">
                    {t("points")}: {x.earned}/{x.possible} · {pct(x.earned, x.possible)} · {t("gaps")}: {x.gaps}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {firm ? <p className="text-xs text-muted-foreground">{t("indicative")}</p> : null}

      {out.sections.map((s, i) => (
        <Card key={i} className="gap-4 py-5 shadow-xs">
          <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
            <CardTitle className="text-base">{(ar ? s.titleAr : null) ?? s.title}</CardTitle>
            {s.before && s.after ? (
              <span className="text-sm tabular-nums">
                {pct(s.before.earned, s.before.possible)} →{" "}
                <span className="font-medium">{pct(s.after.earned, s.after.possible)}</span>
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            {s.changes.length === 0 ? <p className="text-sm text-muted-foreground">{t("noChanges")}</p> : null}
            {s.changes.map((c, j) => (
              <div key={j} className="grid gap-1 border-t pt-3 text-sm first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  {c.ref ? <span className="text-muted-foreground tabular-nums">{c.ref}</span> : null}
                  <span className="font-medium">{(ar ? c.promptAr : null) ?? c.prompt}</span>
                  <Badge variant="outline">{t(`change.${c.change}`)}</Badge>
                  {c.wordingChanged ? <Badge variant="secondary">{t("reworded")}</Badge> : null}
                </div>
                <p className="text-muted-foreground">
                  {value(c.before?.value)} → <span className="font-medium text-foreground">{value(c.after?.value)}</span>
                  {firm && c.before?.points !== undefined && c.after ? (
                    <span className="ms-2 text-xs tabular-nums">
                      ({c.before?.points ?? "—"} → {c.after.points ?? "—"} {t("pts")})
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
            {s.unanswered ? <p className="text-xs text-muted-foreground">{t("unanswered", { n: s.unanswered })}</p> : null}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

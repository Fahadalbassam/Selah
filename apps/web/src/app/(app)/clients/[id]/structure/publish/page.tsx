import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForbiddenError } from "@/authz";
import { isUuid } from "@/lib/ids";
import { localName } from "@/lib/names";
import { localText } from "@/lib/org-chart-tree";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { withPrincipal } from "@/server/page";
import { dayBefore, publishPreview } from "@/services/org-chart";
import { PublishForm } from "./publish-form";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Publishing a client's structure (org chart, part 5), for the firm admin,
// the client's lead and its deputy; anyone else, and another client, 404.
// Before the one main action the page shows what the new version changes
// against the one in effect (units and positions added, moved, renamed,
// removed), what happens on the day it takes effect to the people on the
// positions it drops (part 3's rule) and to the people planned for the draft
// (placed, or skipped and why), and takes the day and the board resolution.
// The day is in the address (?on=), so the lists always match it. Selah
// lists the changes; it never says whether they are good.
export default async function PublishStructurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ on?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { on } = await searchParams;
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    try {
      // A day before the earliest allowed (today, or the current version's day) falls back to that day.
      return await publishPreview(tx, principal, id, on && DAY.test(on) ? on : null);
    } catch (e) {
      // Not a publisher of this client, or no draft: the same 404 as a missing page.
      if (e instanceof ForbiddenError || e instanceof NotFoundError || e instanceof BadRequestError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const [t, format, locale] = await Promise.all([getTranslations("orgChart.publish"), getFormatter(), getLocale()]);
  const lang = locale === "ar" ? "ar" : "en";
  const ar = lang === "ar";
  const base = `/clients/${id}/structure`;
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" });
  const unit = (u: { code: string; nameAr: string | null; nameEn: string | null } | null) => (u ? `${localText(u.nameAr, u.nameEn, lang)} (${u.code})` : t("top"));
  const position = (p: { code: string; titleAr: string | null; titleEn: string | null }) => `${localText(p.titleAr, p.titleEn, lang)} (${p.code})`;
  const c = data.changes;

  const group = (title: string, rows: ReactNode[]) =>
    rows.length ? (
      <div className="grid gap-1.5">
        <h3 className="text-sm font-medium">
          {title} <span className="text-muted-foreground tabular-nums">({new Intl.NumberFormat(locale).format(rows.length)})</span>
        </h3>
        <ul className="grid gap-1 text-sm text-muted-foreground">{rows}</ul>
      </div>
    ) : null;
  const li = (key: string, text: string) => (
    <li key={key} dir="auto">
      {text}
    </li>
  );

  return (
    <>
      <Link href={base} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back", { client: localName(data.client, ar) })}
      </Link>
      <PageHeader title={t("title", { n: data.nextNumber })} description={t("hint")} />

      <Card className="gap-4 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("changes.title")}</CardTitle>
          <CardDescription>
            {data.current ? t("changes.against", { n: data.current.number ?? 0, date: data.current.effectiveOn ? day(data.current.effectiveOn) : "—" }) : t("changes.first")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-5">
          {c.none ? <p className="text-sm text-muted-foreground">{t("changes.none")}</p> : null}
          {group(t("changes.unitsAdded"), c.units.added.map((u) => li(u.id, unit(u))))}
          {group(
            t("changes.unitsMoved"),
            c.units.moved.map((m) => li(m.unit.id, t("changes.movedLine", { what: unit(m.unit), from: unit(m.from), to: unit(m.to) }))),
          )}
          {group(
            t("changes.unitsRenamed"),
            c.units.renamed.map((m) => li(m.unit.id, t("changes.renamedLine", { before: localText(m.before.nameAr, m.before.nameEn, lang), after: unit(m.unit) }))),
          )}
          {group(t("changes.unitsRemoved"), c.units.removed.map((u) => li(u.id, unit(u))))}
          {group(t("changes.positionsAdded"), c.positions.added.map((p) => li(p.id, position(p))))}
          {group(
            t("changes.positionsMoved"),
            c.positions.moved.map((m) => li(m.position.id, t("changes.movedLine", { what: position(m.position), from: unit(m.from), to: unit(m.to) }))),
          )}
          {group(
            t("changes.positionsRenamed"),
            c.positions.renamed.map((m) => li(m.position.id, t("changes.renamedLine", { before: localText(m.before.titleAr, m.before.titleEn, lang), after: position(m.position) }))),
          )}
          {group(t("changes.positionsRemoved"), c.positions.removed.map((p) => li(p.id, position(p))))}
        </CardContent>
      </Card>

      {data.dropped.length ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("dropped.title")}</CardTitle>
            <CardDescription>{t("dropped.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            <ul className="grid gap-1.5 text-sm">
              {data.dropped.map((h, i) => (
                <li key={`${h.code}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                  <bdi className="font-medium">{h.name ?? "—"}</bdi>
                  <span className="text-muted-foreground" dir="auto">
                    {position(h)}
                  </span>
                  <span className="text-muted-foreground">· {h.cancelled ? t("dropped.cancelled") : t("dropped.ends", { date: day(h.endsOn!) })}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {data.plans.length ? (
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("plans.title")}</CardTitle>
            <CardDescription>{t("plans.hint", { date: day(data.effectiveOn) })}</CardDescription>
          </CardHeader>
          <CardContent className="px-5">
            <ul className="grid gap-1.5 text-sm">
              {data.plans.map((p, i) => (
                <li key={`${p.positionId}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                  <bdi className="font-medium">{p.name ?? "—"}</bdi>
                  <span className="text-muted-foreground" dir="ltr">
                    {p.code}
                  </span>
                  {p.outcome === "place" ? (
                    <span className="text-muted-foreground">
                      · {t("plans.place", { date: day(data.effectiveOn) })}
                      {p.leaving.length ? (
                        <>
                          {" · "}
                          {t("plans.takesOver", { names: p.leaving.join(ar ? "، " : ", "), date: day(dayBefore(data.effectiveOn)) })}
                        </>
                      ) : null}
                    </span>
                  ) : (
                    <ToneBadge tone="waiting">{t(`plans.${p.outcome}`)}</ToneBadge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-4 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("form.title")}</CardTitle>
          <CardDescription>{t("form.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <PublishForm
            clientId={id}
            draftId={data.draftId}
            number={data.nextNumber}
            effectiveOn={data.effectiveOn}
            earliest={data.earliest}
            today={data.today}
            resolutions={data.resolutions.map((d) => ({ id: d.id, title: d.title }))}
            base={base}
            disabled={!data.hasUnits}
          />
        </CardContent>
      </Card>
    </>
  );
}

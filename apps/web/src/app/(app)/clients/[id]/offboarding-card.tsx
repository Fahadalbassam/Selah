import { Archive } from "lucide-react";
import { RotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { ShieldCheck } from "@/components/animate-ui/icons/shield-check";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { FormDialog } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GRACE_DAYS, OFFBOARDING_LIMITS, RETENTION_YEARS } from "@/lib/offboarding";
import type { OffboardingView } from "@/services/offboarding";

/**
 * Leaving (baseline: Offboarding, 0025), on the client page: archive once
 * every project is closed, the grace period and retention date, restoring,
 * and legal holds. Every button is one the database will take.
 */
export async function OffboardingCard({ clientId, view }: { clientId: string; view: OffboardingView }) {
  const t = await getTranslations("offboarding");
  const format = await getFormatter();
  const day = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const base = `/api/clients/${clientId}/offboarding`;
  const current = view.current;
  const standing = view.holds.filter((h) => !h.releasedAt);
  const reason = (name: string, label: string) => ({ name, label, type: "textarea" as const, required: true, maxLength: OFFBOARDING_LIMITS.reason.max });

  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{current ? t("hintArchived", { years: RETENTION_YEARS }) : t("hint", { years: RETENTION_YEARS })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 text-sm">
        {current ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted-foreground">{t("archivedOn")}</dt>
            <dd>{current.archivedBy ? t("on", { date: day(current.archivedAt), name: current.archivedBy }) : day(current.archivedAt)}</dd>
            <dt className="text-muted-foreground">{t("graceUntil")}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {day(current.graceUntil)}
              <ToneBadge tone={current.inGrace ? "active" : "neutral"}>{current.inGrace ? t("graceRunning") : t("graceOver")}</ToneBadge>
            </dd>
            <dt className="text-muted-foreground">{t("retainUntil")}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {day(current.retainUntil)}
              {standing.length ? <ToneBadge tone="waiting">{t("held")}</ToneBadge> : null}
            </dd>
            {current.draftsDeleted ? (
              <>
                <dt className="text-muted-foreground">{t("draftsDeletedLabel")}</dt>
                <dd>{t("draftsDeleted", { count: current.draftsDeleted })}</dd>
              </>
            ) : null}
            {current.note ? (
              <>
                <dt className="text-muted-foreground">{t("note")}</dt>
                <dd className="whitespace-pre-line" dir="auto">
                  {current.note}
                </dd>
              </>
            ) : null}
          </dl>
        ) : view.blockers.length ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground">{t("blocked", { count: view.blockers.length })}</p>
            <ul className="space-y-1">
              {view.blockers.map((b) => (
                <li key={b.projectId}>
                  <Link href={`/projects/${b.projectId}?tab=closing`} className="hover:underline" dir="auto">
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : !view.signed ? (
          <p className="text-muted-foreground">{t("neverSigned")}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {view.can.archive ? (
            <FormDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Archive />
                  {t("archive")}
                </Button>
              }
              title={t("archiveTitle")}
              description={
                view.drafts.length
                  ? `${t("archiveHint", { years: RETENTION_YEARS })} ${t("archiveDrafts", { count: view.drafts.length, titles: view.drafts.map((d) => d.title).join(" · ") })}`
                  : t("archiveHint", { years: RETENTION_YEARS })
              }
              endpoint={base}
              extra={{ step: "archive" }}
              fields={[
                {
                  name: "graceDays",
                  label: t("graceField"),
                  type: "select",
                  required: true,
                  defaultValue: String(GRACE_DAYS.default),
                  options: [0, 30, GRACE_DAYS.default, GRACE_DAYS.max].map((n) => ({ value: String(n), label: n ? t("days", { count: n }) : t("noGrace") })),
                },
                { name: "note", label: t("noteField"), type: "textarea", maxLength: OFFBOARDING_LIMITS.note, placeholder: t("notePlaceholder") },
              ]}
              submitLabel={t("archive")}
            />
          ) : null}
          {view.can.restore ? (
            <FormDialog
              trigger={
                <Button size="sm" variant="outline">
                  <RotateCcw />
                  {t("restore")}
                </Button>
              }
              title={t("restoreTitle")}
              description={t("restoreHint")}
              endpoint={base}
              extra={{ step: "restore" }}
              fields={[reason("reason", t("reasonField"))]}
              submitLabel={t("restore")}
            />
          ) : null}
          {view.can.hold ? (
            <FormDialog
              trigger={
                <Button size="sm" variant="ghost">
                  <ShieldCheck />
                  {t("placeHold")}
                </Button>
              }
              title={t("placeHold")}
              description={t("holdHint")}
              endpoint={`${base}/holds`}
              fields={[reason("reason", t("holdReason"))]}
              submitLabel={t("placeHold")}
            />
          ) : null}
        </div>

        {view.holds.length ? (
          <div className="space-y-2 border-t pt-3">
            <p className="font-medium">{t("holds")}</p>
            <ul className="space-y-2">
              {view.holds.map((h) => (
                <li key={h.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ToneBadge tone={h.releasedAt ? "neutral" : "waiting"}>{h.releasedAt ? t("released") : t("standing")}</ToneBadge>
                    <span className="text-xs text-muted-foreground">{h.placedBy ? t("on", { date: day(h.placedAt), name: h.placedBy }) : day(h.placedAt)}</span>
                  </div>
                  <p className="whitespace-pre-line" dir="auto">
                    {h.reason}
                  </p>
                  {h.releasedAt ? (
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {t("releasedOn", { date: day(h.releasedAt), name: h.releasedBy ?? "" })} {h.releaseReason}
                    </p>
                  ) : view.can.hold ? (
                    <FormDialog
                      trigger={
                        <Button size="sm" variant="ghost">
                          {t("release")}
                        </Button>
                      }
                      title={t("release")}
                      description={t("releaseHint")}
                      endpoint={`${base}/holds/${h.id}`}
                      method="PATCH"
                      fields={[reason("reason", t("releaseReason"))]}
                      submitLabel={t("release")}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {view.history.length ? (
          <div className="space-y-1.5 border-t pt-3">
            <p className="font-medium">{t("history")}</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {view.history.map((r) => (
                <li key={r.id} dir="auto">
                  {t("historyLine", { archived: day(r.archivedAt), restored: day(r.restoredAt), name: r.restoredBy ?? "" })} {r.restoreReason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

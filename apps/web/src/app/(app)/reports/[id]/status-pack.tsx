"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StatusPack } from "@/services/status-pack";

const MOVED_ORDER = ["in_progress", "blocked", "awaiting_review", "revision_requested", "verified_complete", "closed"];

/**
 * The lists of a monthly status pack (F19): what needs a decision, what is
 * overdue and with whom, what moved twice or more, what risk was accepted
 * and by whom, and what was verified in the period.
 */
export function StatusPackLists({ pack, links }: { pack: StatusPack; links: boolean }) {
  const t = useTranslations("statusPack");
  const tStatus = useTranslations("status");
  const format = useFormatter();
  const day = (d: string) => format.dateTime(new Date(`${d.slice(0, 10)}T00:00:00`), { dateStyle: "medium" });
  const title = (kind: "action" | "recommendation", id: string, text: string) =>
    links ? (
      <Link href={`/${kind === "action" ? "actions" : "recommendations"}/${id}`} className="font-medium hover:underline" dir="auto">
        {text}
      </Link>
    ) : (
      <span className="font-medium" dir="auto">
        {text}
      </span>
    );
  const moved = MOVED_ORDER.filter((s) => pack.moved[s]);

  const section = (key: string, count: number, head: string[], rows: React.ReactNode) => (
    <Card className="gap-3 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">
          {t(`${key}.title`)} <span className="text-muted-foreground tabular-nums">{count}</span>
        </CardTitle>
        <CardDescription>{t(`${key}.hint`)}</CardDescription>
      </CardHeader>
      {count ? (
        <CardContent className="px-5">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  {head.map((h, i) => (
                    <TableHead key={h} className={i > 1 ? "text-end" : undefined}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>{rows}</TableBody>
            </Table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );

  return (
    <div className="space-y-4">
      {section(
        "decisions",
        pack.decisions.length,
        [t("item"), t("decisions.what"), t("since")],
        pack.decisions.map((d) => (
          <TableRow key={`${d.kind}-${d.id}`}>
            <TableCell className="max-w-96">{title(d.kind === "response" ? "recommendation" : "action", d.id, d.title)}</TableCell>
            <TableCell>{d.kind === "response" ? t("decisions.response") : t("decisions.deadline", { date: day(d.proposedDueDate!) })}</TableCell>
            <TableCell className="text-end tabular-nums">{day(d.since)}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "overdue",
        pack.overdue.length,
        [t("item"), t("owner"), t("due"), t("late")],
        pack.overdue.map((o) => (
          <TableRow key={o.id}>
            <TableCell className="max-w-96">{title("action", o.id, o.title)}</TableCell>
            <TableCell className="text-muted-foreground">{o.owner ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{day(o.dueDate)}</TableCell>
            <TableCell className="text-end tabular-nums text-destructive">{t("days", { n: o.days })}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "slipped",
        pack.slipped.length,
        [t("item"), t("owner"), t("original"), t("moves")],
        pack.slipped.map((o) => (
          <TableRow key={o.id}>
            <TableCell className="max-w-96">{title("action", o.id, o.title)}</TableCell>
            <TableCell className="text-muted-foreground">{o.owner ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{o.baselineDueDate ? day(o.baselineDueDate) : "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{o.moves}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "riskAccepted",
        pack.riskAccepted.length,
        [t("item"), t("acceptedBy"), t("on")],
        pack.riskAccepted.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="max-w-96">{title("action", r.id, r.title)}</TableCell>
            <TableCell className="text-muted-foreground">{r.acceptedBy ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{day(r.on)}</TableCell>
          </TableRow>
        )),
      )}
      {section(
        "verified",
        pack.verified.length,
        [t("item"), t("owner"), t("on")],
        pack.verified.map((v) => (
          <TableRow key={v.id}>
            <TableCell className="max-w-96">{title("action", v.id, v.title)}</TableCell>
            <TableCell className="text-muted-foreground">{v.owner ?? "—"}</TableCell>
            <TableCell className="text-end tabular-nums">{day(v.on)}</TableCell>
          </TableRow>
        )),
      )}
      <Card className="gap-3 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("moved.title")}</CardTitle>
          <CardDescription>{moved.length ? t("moved.hint") : t("moved.none")}</CardDescription>
        </CardHeader>
        {moved.length ? (
          <CardContent className="flex flex-wrap gap-x-6 gap-y-2 px-5 text-sm">
            {moved.map((s) => (
              <span key={s}>
                {tStatus(s as never)} <span className="font-semibold tabular-nums">{pack.moved[s]}</span>
              </span>
            ))}
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

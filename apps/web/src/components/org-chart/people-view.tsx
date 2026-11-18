"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { SectionHeader } from "@/components/section-header";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { outlineTree, type OutlineNode } from "@/lib/org-chart-outline";
import { localText } from "@/lib/org-chart-tree";
import type { OrgPosition, OrgUnit } from "@/services/org-chart";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { toast } from "@/components/ui/toast";
import type { DroppedHolding } from "@/services/org-chart";
import { HoldersPanel, useOrgChartError, type HolderCandidate } from "./holders-panel";

export interface Vacancy {
  positionId: string;
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  unitNameAr: string | null;
  unitNameEn: string | null;
}

/**
 * "People in positions" on the current published structure (org chart,
 * part 3): for the client's admin, who keeps the names current directly, and
 * the firm's editors. The vacant positions first (listVacancies), then every
 * position in the structure's order with who holds it today; "Change" opens
 * the side panel to place someone, end a holding, or remove one entered by
 * mistake. The structure itself (units, positions, lines) is the firm's and
 * changes only through its draft.
 */
export function PeopleView(props: {
  units: OrgUnit[];
  positions: OrgPosition[];
  vacancies: Vacancy[];
  candidates: HolderCandidate[];
  side: "firm" | "client";
  /** Names still kept on positions a later version dropped (S1): removable, asked first. */
  dropped?: DroppedHolding[];
}) {
  const t = useTranslations("orgChart.people");
  const tTree = useTranslations("orgChart.tree");
  const tc = useTranslations("common");
  const lang = useLocale() === "ar" ? "ar" : "en";
  const [open, setOpen] = useState<string | null>(null);
  const units = new Map(props.units.map((u) => [u.id, u]));
  // The structure's own order: each unit's positions, then the units under it.
  const ordered: OrgPosition[] = [];
  const walk = (n: OutlineNode<OrgUnit, OrgPosition>) => {
    ordered.push(...n.positions);
    n.children.forEach(walk);
  };
  outlineTree(props.units, props.positions).forEach(walk);
  const position = open ? props.positions.find((p) => p.id === open) : undefined;
  const title = (p: { titleAr: string | null; titleEn: string | null }) => localText(p.titleAr, p.titleEn, lang);
  const change = (id: string, label: string) => (
    <Button variant="ghost" size="sm" onClick={() => setOpen(id)} aria-label={t("changeLabel", { title: label })}>
      {t("change")}
    </Button>
  );

  return (
    <section className="space-y-4" aria-label={t("title")}>
      <SectionHeader title={t("title")} description={props.side === "client" ? t("hintClient") : t("hintFirm")} />
      <div className="rounded-xl border bg-card p-5 shadow-xs">
        <h3 className="text-sm font-semibold">{t("vacancies")}</h3>
        {props.vacancies.length ? (
          <ul className="mt-2 divide-y">
            {props.vacancies.map((v) => (
              <li key={v.positionId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="grid min-w-0">
                  <span className="truncate font-medium" dir="auto">
                    {title(v)}
                  </span>
                  <span className="truncate text-xs text-muted-foreground" dir="auto">
                    <bdi dir="ltr">{v.code}</bdi> · {localText(v.unitNameAr, v.unitNameEn, lang)}
                  </span>
                </span>
                {change(v.positionId, title(v))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("noVacancies")}</p>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("position")}</TableHead>
              <TableHead>{t("unit")}</TableHead>
              <TableHead>{t("holders")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((p) => {
              const names = p.holders.flatMap((h) => (h.named && h.name ? [h.name] : []));
              const u = units.get(p.unitId);
              return (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-normal">
                    <p className={p.isHead ? "font-medium" : undefined} dir="auto">
                      {title(p)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                      {p.code}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground" dir="auto">
                    {u ? localText(u.nameAr, u.nameEn, lang) : ""}
                  </TableCell>
                  <TableCell className="whitespace-normal" dir="auto">
                    {names.length ? names.join(lang === "ar" ? "، " : ", ") : p.vacant ? <span className="text-muted-foreground">{tTree("vacant")}</span> : null}
                  </TableCell>
                  <TableCell className="text-end">{change(p.id, title(p))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {props.dropped?.length ? <DroppedNames items={props.dropped} /> : null}
      {position ? (
        <Sheet open onOpenChange={(o) => (o ? null : setOpen(null))}>
          <SheetContent side={lang === "ar" ? "left" : "right"} showCloseButton={false} className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader className="p-5 pb-0">
              <SheetTitle dir="auto">{title(position)}</SheetTitle>
              <SheetDescription dir="auto">{localText(units.get(position.unitId)?.nameAr ?? null, units.get(position.unitId)?.nameEn ?? null, lang)}</SheetDescription>
            </SheetHeader>
            <div className="p-5">
              <HoldersPanel positionId={position.id} plannedCount={position.plannedCount} candidates={props.candidates} side={props.side} primary />
            </div>
            <SheetFooter className="flex-row justify-end p-5 pt-0">
              <Button type="button" variant="outline" onClick={() => setOpen(null)}>
                {tc("close")}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}
    </section>
  );
}

/**
 * Names on positions a later version dropped: publishing ended those
 * holdings, but they still name someone (and keep a client from switching to
 * minimal records). Each can be removed like a mistake: asked first, audited
 * without the name.
 */
function DroppedNames({ items }: { items: DroppedHolding[] }) {
  const t = useTranslations("orgChart.people");
  const th = useTranslations("orgChart.holders");
  const format = useFormatter();
  const lang = useLocale() === "ar" ? "ar" : "en";
  const router = useRouter();
  const say = useOrgChartError();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  async function remove(h: DroppedHolding) {
    if (!(await confirm(th("removeConfirm", { name: h.name ?? "—" })))) return;
    setBusy(h.holderId);
    const r = await callApi(`/api/org-chart/positions/${h.positionId}/holders/${h.holderId}`, "DELETE");
    setBusy(null);
    if (!r.ok) return toast.error(say(r));
    toast.success(th("removed"));
    router.refresh();
  }
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <h3 className="text-sm font-semibold">{t("dropped")}</h3>
      <p className="text-xs text-muted-foreground">{t("droppedHint")}</p>
      <ul className="mt-2 divide-y">
        {items.map((h) => (
          <li key={h.holderId} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="grid min-w-0">
              <span className="truncate font-medium" dir="auto">
                {h.name ?? "—"}
              </span>
              <span className="truncate text-xs text-muted-foreground" dir="auto">
                {localText(h.titleAr, h.titleEn, lang)} · <bdi dir="ltr">{h.code}</bdi> · {th("range", { from: day(h.from), to: day(h.to ?? h.from) })}
              </span>
            </span>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void remove(h)}>
              {th("remove")}
            </Button>
          </li>
        ))}
      </ul>
      {confirmDialog}
    </div>
  );
}

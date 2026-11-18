"use client";

import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { Lock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { callApi } from "@/components/form-dialog";
import { PersonPicker } from "@/components/person-picker";
import { SectionHeader } from "@/components/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ORG_CHART_LIMITS, ORG_UNIT_KINDS, type OrgUnitKind } from "@/lib/org-chart";
import { arrowMove, outlineTree, parseSpecialties, positionMove, reportsToChoices, unitAndBelow, unitMove, type OutlineNode, type UnitMove } from "@/lib/org-chart-outline";
import { localText } from "@/lib/org-chart-tree";
import type { OrgPosition, OrgUnit } from "@/services/org-chart";
import { useOrgChartError } from "./holders-panel";

type Node = OutlineNode<OrgUnit, OrgPosition>;
type Panel =
  | { kind: "unit"; id: string }
  | { kind: "newUnit"; parentId: string | null }
  | { kind: "position"; id: string }
  | { kind: "newPosition"; unitId: string }
  | null;
type Moving = { kind: "unit" | "position"; id: string } | null;

export interface Department {
  id: string;
  nameAr: string | null;
  nameEn: string | null;
}

/**
 * The outline editor (org chart, part 3), firm side, on the Structure tab:
 * the firm's draft as an indented list. Each row's ⋯ menu adds, moves up and
 * down, indents, outdents, moves under another unit and removes; opening a
 * row (its name) opens the side panel with its details (for a position:
 * reports to, head, specialties, how many people, and who holds it today, read only: holders change on "People in positions", never from the draft). No drag
 * and drop. Every change goes through the services of part 1
 * (services/org-chart.ts) by its API route, which checks it again; the page
 * then reloads the draft. For the firm's editors only; the draft stays the
 * firm's until it is published.
 */
export function OutlineEditor(props: {
  clientId: string;
  draftId: string | null;
  /** A version is published: the draft can start again from it. */
  canRestart: boolean;
  units: OrgUnit[];
  positions: OrgPosition[];
  departments: Department[];
  /** Positions (lineages) of the current published version: their holders show, read only. */
  liveLineages: string[];
  /** "People in positions" on the published structure, where holders change; null before anything is published. */
  peopleHref: string | null;
  /** The client keeps names (not minimal records): show who holds a position. */
  names: boolean;
  /** Before anything exists the page has no version line: the editor says itself that this is the firm's draft. */
  banner?: boolean;
}) {
  const t = useTranslations("orgChart.editor");
  const tChart = useTranslations("orgChart");
  const tk = useTranslations("orgChart.kinds");
  const tTree = useTranslations("orgChart.tree");
  const locale = useLocale();
  const lang = locale === "ar" ? "ar" : "en";
  const rtl = lang === "ar";
  const router = useRouter();
  const say = useOrgChartError();
  const [confirm, confirmDialog] = useConfirm();
  const [panel, setPanel] = useState<Panel>(null);
  const [moving, setMoving] = useState<Moving>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const tree = outlineTree(props.units, props.positions);
  const unitName = (u: Pick<OrgUnit, "nameAr" | "nameEn">) => localText(u.nameAr, u.nameEn, lang);
  const title = (p: Pick<OrgPosition, "titleAr" | "titleEn">) => localText(p.titleAr, p.titleEn, lang);
  const department = (id: string | null) => props.departments.find((d) => d.id === id);

  // After a change the page reloads the draft: once the new rows arrive, put the keyboard back on the row that moved.
  const before = useRef<{ units: OrgUnit[]; positions: OrgPosition[] } | null>(null);
  const focusAfterReload = (id: string) => {
    before.current = { units: props.units, positions: props.positions };
    setFocusId(id);
  };
  useEffect(() => {
    if (!focusId || (before.current && before.current.units === props.units && before.current.positions === props.positions)) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-row="${focusId}"] [data-row-main]`);
    el?.focus();
    // Done either way: a row that is gone (removed) leaves focus where it is.
    before.current = null;
    setFocusId(null);
  }, [focusId, props.units, props.positions]);

  async function run(url: string, method: string, body: unknown, done: string, focus?: string) {
    setBusy(true);
    const r = await callApi(url, method, body);
    setBusy(false);
    if (!r.ok) {
      toast.error(say(r));
      return false;
    }
    toast.success(done);
    if (focus) focusAfterReload(focus);
    router.refresh();
    return true;
  }

  const moveUnitBy = (node: Node, move: UnitMove) => {
    const to = unitMove(node, move);
    if (to) void run(`/api/org-chart/units/${node.unit.id}/move`, "POST", to, t("moved"), node.unit.id);
  };
  const movePositionBy = (node: Node, p: OrgPosition, move: "up" | "down") => {
    const to = positionMove(node.positions, p.id, move);
    if (to) void run(`/api/org-chart/positions/${p.id}/move`, "POST", to, t("moved"), p.id);
  };

  const keys = (e: KeyboardEvent, move: (m: UnitMove) => void) => {
    if (!e.altKey) return;
    const m = arrowMove(e.key, rtl);
    if (!m) return;
    // Always ours on a row, even while a move is saving: Alt with a side arrow would otherwise take the browser back.
    e.preventDefault();
    if (!busy) move(m);
  };

  async function removeUnit(node: Node) {
    if (!(await confirm(t("removeUnitConfirm", { name: unitName(node.unit) })))) return;
    await run(`/api/org-chart/units/${node.unit.id}`, "DELETE", undefined, t("removed"));
  }
  async function removePosition(p: OrgPosition) {
    if (!(await confirm(t("removePositionConfirm", { title: title(p) })))) return;
    await run(`/api/org-chart/positions/${p.id}`, "DELETE", undefined, t("removed"));
  }
  async function restart() {
    if (!props.draftId || !(await confirm(t("restartConfirm")))) return;
    await run(`/api/clients/${props.clientId}/structure/draft/reset`, "POST", { draftId: props.draftId }, t("restarted"));
  }

  const shortcut = (m: UnitMove) => (m === "up" ? "Alt+↑" : m === "down" ? "Alt+↓" : m === "indent" ? (rtl ? "Alt+←" : "Alt+→") : rtl ? "Alt+→" : "Alt+←");

  const unitRow = (node: Node) => {
    const u = node.unit;
    const name = unitName(u);
    const linked = department(u.departmentId);
    const empty = node.children.length === 0 && node.positions.length === 0;
    return (
      <li key={u.id} data-row={u.id} className="grid gap-1">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-xs">
          <span className="w-16 shrink-0 truncate text-xs text-muted-foreground tabular-nums" dir="ltr">
            {u.code}
          </span>
          <button
            type="button"
            data-row-main
            className="min-w-0 flex-1 truncate rounded-sm text-start font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => setPanel({ kind: "unit", id: u.id })}
            onKeyDown={(e) => keys(e, (m) => moveUnitBy(node, m))}
            dir="auto"
          >
            {name}
          </button>
          <span className="hidden shrink-0 items-center gap-1 md:flex">
            <Badge variant="outline">{tk(u.kind)}</Badge>
            {u.advisory ? <Badge variant="outline">{t("advisory")}</Badge> : null}
            {linked ? <Badge variant="secondary">{t("linked", { name: localText(linked.nameAr, linked.nameEn, lang) })}</Badge> : null}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" aria-label={t("rowActions", { name })} title={t("rowActions", { name })} disabled={busy}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
              <DropdownMenuItem onSelect={() => setPanel({ kind: "unit", id: u.id })}>{t("details")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPanel({ kind: "newUnit", parentId: u.id })}>{t("addUnitInside")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPanel({ kind: "newPosition", unitId: u.id })}>{t("addPosition")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {(["up", "down", "indent", "outdent"] as const).map((m) => (
                <DropdownMenuItem key={m} disabled={!unitMove(node, m)} onSelect={() => moveUnitBy(node, m)}>
                  {t(m === "up" ? "moveUp" : m === "down" ? "moveDown" : m)}
                  <DropdownMenuShortcut dir="ltr">{shortcut(m)}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setMoving({ kind: "unit", id: u.id })}>{t("moveUnder")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={!empty} onSelect={() => void removeUnit(node)}>
                {empty ? t("remove") : t("removeUnitBlocked")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {node.positions.length ? (
          <ul aria-label={t("positions", { name })} className="ms-4 grid gap-0.5 border-s ps-3">
            {node.positions.map((p) => positionRow(node, p))}
          </ul>
        ) : null}
        {node.children.length ? (
          <ul aria-label={t("units", { name })} className="ms-4 grid gap-1 border-s ps-3">
            {node.children.map(unitRow)}
          </ul>
        ) : null}
      </li>
    );
  };

  const positionRow = (node: Node, p: OrgPosition) => {
    const name = title(p);
    const holders = p.holders.flatMap((h) => (h.named && h.name ? [h.name] : []));
    const at = node.positions.findIndex((x) => x.id === p.id);
    return (
      <li key={p.id} data-row={p.id} className="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted/50">
        <span className="w-16 shrink-0 truncate text-xs text-muted-foreground tabular-nums" dir="ltr">
          {p.code}
        </span>
        <button
          type="button"
          data-row-main
          className="grid min-w-0 flex-1 rounded-sm text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => setPanel({ kind: "position", id: p.id })}
          onKeyDown={(e) => keys(e, (m) => (m === "up" || m === "down" ? movePositionBy(node, p, m) : undefined))}
        >
          <span className={`truncate hover:underline ${p.isHead ? "font-medium" : ""}`} dir="auto">
            {name}
          </span>
          <span className="truncate text-xs text-muted-foreground" dir="auto">
            {holders.length ? holders.join(rtl ? "، " : ", ") : p.vacant ? tTree("vacant") : null}
          </span>
        </button>
        <span className="hidden shrink-0 items-center gap-1 md:flex">
          {p.isHead ? <Badge variant="outline">{t("head")}</Badge> : null}
          {p.plannedCount > 1 ? <Badge variant="outline">{t("planned", { n: p.plannedCount })}</Badge> : null}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={t("rowActions", { name })} title={t("rowActions", { name })} disabled={busy}>
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            <DropdownMenuItem onSelect={() => setPanel({ kind: "position", id: p.id })}>{t("details")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={at <= 0} onSelect={() => movePositionBy(node, p, "up")}>
              {t("moveUp")}
              <DropdownMenuShortcut dir="ltr">{shortcut("up")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={at >= node.positions.length - 1} onSelect={() => movePositionBy(node, p, "down")}>
              {t("moveDown")}
              <DropdownMenuShortcut dir="ltr">{shortcut("down")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.units.length < 2} onSelect={() => setMoving({ kind: "position", id: p.id })}>
              {t("moveToUnit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void removePosition(p)}>
              {t("remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  const empty = props.units.length === 0;
  const unitFor = (id: string) => props.units.find((u) => u.id === id);
  const positionFor = (id: string) => props.positions.find((p) => p.id === id);

  return (
    <section className="space-y-4" aria-label={t("title")}>
      {props.banner ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          {`${tChart("draftBanner")} ${tChart("notPublished")}`}
        </p>
      ) : null}
      <SectionHeader title={t("title")} description={empty ? undefined : t("hint")}>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={empty ? "default" : "outline"} onClick={() => setPanel({ kind: "newUnit", parentId: null })}>
            <Plus />
            {t("addUnit")}
          </Button>
          {props.canRestart && props.draftId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={t("pageActions")} title={t("pageActions")}>
                  <Ellipsis className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void restart()}>{t("restart")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </SectionHeader>
      {empty ? (
        <EmptyState title={t("emptyTitle")} description={t("empty")} />
      ) : (
        <div ref={list} className="space-y-2">
          <ul className="grid gap-1">{tree.map(unitRow)}</ul>
          <p className="text-xs text-muted-foreground">{t("shortcuts")}</p>
        </div>
      )}

      {panel?.kind === "unit" || panel?.kind === "newUnit" ? (
        <UnitPanel
          clientId={props.clientId}
          unit={panel.kind === "unit" ? unitFor(panel.id) : undefined}
          parent={panel.kind === "newUnit" && panel.parentId ? unitFor(panel.parentId) : undefined}
          departments={props.departments}
          onClose={() => setPanel(null)}
          onSaved={(id) => {
            setPanel(null);
            focusAfterReload(id);
            router.refresh();
          }}
        />
      ) : null}
      {panel?.kind === "position" || panel?.kind === "newPosition" ? (
        <PositionPanel
          position={panel.kind === "position" ? positionFor(panel.id) : undefined}
          unit={panel.kind === "newPosition" ? unitFor(panel.unitId) : unitFor(positionFor(panel.id)?.unitId ?? "")}
          positions={props.positions}
          units={props.units}
          live={panel.kind === "position" && props.liveLineages.includes(positionFor(panel.id)?.lineageId ?? "")}
          peopleHref={props.peopleHref}
          names={props.names}
          onClose={() => setPanel(null)}
          onSaved={(id) => {
            setPanel(null);
            focusAfterReload(id);
            router.refresh();
          }}
        />
      ) : null}
      {moving ? (
        <MoveDialog
          moving={moving}
          units={props.units}
          positions={props.positions}
          onClose={() => setMoving(null)}
          onMove={async (target) => {
            const ok =
              moving.kind === "unit"
                ? await run(`/api/org-chart/units/${moving.id}/move`, "POST", { parentId: target }, t("moved"), moving.id)
                : await run(`/api/org-chart/positions/${moving.id}/move`, "POST", { unitId: target }, t("moved"), moving.id);
            if (ok) setMoving(null);
          }}
        />
      ) : null}
      {confirmDialog}
    </section>
  );
}

/** The side panel opens from the reading direction's end: the left in Arabic, the right in English. */
function useSide() {
  return useLocale() === "ar" ? ("left" as const) : ("right" as const);
}

/** A unit's details, or a new unit (at the top or inside `parent`). */
function UnitPanel(props: { clientId: string; unit?: OrgUnit; parent?: OrgUnit; departments: Department[]; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useTranslations("orgChart.unit");
  const tk = useTranslations("orgChart.kinds");
  const tc = useTranslations("common");
  const lang = useLocale() === "ar" ? "ar" : "en";
  const side = useSide();
  const say = useOrgChartError();
  const u = props.unit;
  const [kind, setKind] = useState<OrgUnitKind>(u?.kind ?? (props.parent ? "department" : "board"));
  const [nameAr, setNameAr] = useState(u?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(u?.nameEn ?? "");
  const [code, setCode] = useState(u?.code ?? "");
  const [level, setLevel] = useState(u ? String(u.level) : "");
  const [advisory, setAdvisory] = useState(u?.advisory ?? false);
  const [departmentId, setDepartmentId] = useState(u?.departmentId ?? "none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = u
    ? t("editTitle", { name: localText(u.nameAr, u.nameEn, lang) })
    : props.parent
      ? t("newInside", { name: localText(props.parent.nameAr, props.parent.nameEn, lang) })
      : t("newTitle");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fields = {
      kind,
      nameAr: nameAr.trim() || null,
      nameEn: nameEn.trim() || null,
      advisory,
      departmentId: departmentId === "none" ? null : departmentId,
    };
    const r = u
      ? await callApi(`/api/org-chart/units/${u.id}`, "PATCH", { ...fields, code: code.trim(), ...(level ? { level: Number(level) } : {}) })
      : await callApi(`/api/clients/${props.clientId}/structure/units`, "POST", {
          ...fields,
          code: code.trim() || null,
          parentId: props.parent?.id ?? null,
          ...(level ? { level: Number(level) } : {}),
        });
    setBusy(false);
    if (!r.ok) return setError(say(r));
    toast.success(tc("saved"));
    props.onSaved(u?.id ?? (r.data as { id: string }).id);
  }

  return (
    <Sheet open onOpenChange={(o) => (o ? null : props.onClose())}>
      <SheetContent side={side} showCloseButton={false} className="w-full overflow-y-auto sm:max-w-lg">
        <form onSubmit={save} className="flex min-h-full flex-col">
          <SheetHeader className="p-5">
            <SheetTitle dir="auto">{heading}</SheetTitle>
            <SheetDescription>{t("hint")}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-5">
            <div className="grid gap-2">
              <Label htmlFor="u-name-ar">{t("nameAr")}</Label>
              <Input id="u-name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={ORG_CHART_LIMITS.name} dir="rtl" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-name-en">{t("nameEn")}</Label>
              <Input id="u-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={ORG_CHART_LIMITS.name} dir="ltr" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-kind">{t("kind")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as OrgUnitKind)}>
                <SelectTrigger id="u-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_UNIT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tk(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="u-code">{t("code")}</Label>
                <Input id="u-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} dir="ltr" required={!!u} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="u-level">{t("level")}</Label>
                <Input
                  id="u-level"
                  type="number"
                  inputMode="numeric"
                  min={ORG_CHART_LIMITS.level.min}
                  max={ORG_CHART_LIMITS.level.max}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  dir="ltr"
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              {u ? t("levelHint") : `${t("codeHint")} ${t("levelHint")}`}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={advisory} onCheckedChange={(v) => setAdvisory(v === true)} className="mt-0.5" />
              <span>{t("advisory")}</span>
            </label>
            {props.departments.length ? (
              <div className="grid gap-2">
                <Label htmlFor="u-dept">{t("department")}</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger id="u-dept" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("departmentNone")}</SelectItem>
                    {props.departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {localText(d.nameAr, d.nameEn, lang)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("departmentHint")}</p>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end gap-2 p-5">
            <Button type="button" variant="outline" onClick={props.onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || (!nameAr.trim() && !nameEn.trim())}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {tc("save")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A position's details (reports to, head, specialties, planned people), or a
 * new position in `unit`. Who holds it is read only here (the lead's
 * decision B1): today's holders when the position is also on the published
 * structure, and a line to "People in positions", where holders change.
 */
function PositionPanel(props: {
  position?: OrgPosition;
  unit?: OrgUnit;
  positions: OrgPosition[];
  units: OrgUnit[];
  /** The position is also on the current published version. */
  live: boolean;
  peopleHref: string | null;
  names: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("orgChart.position");
  const tc = useTranslations("common");
  const lang = useLocale() === "ar" ? "ar" : "en";
  const side = useSide();
  const say = useOrgChartError();
  const p = props.position;
  const [titleAr, setTitleAr] = useState(p?.titleAr ?? "");
  const [titleEn, setTitleEn] = useState(p?.titleEn ?? "");
  const [code, setCode] = useState(p?.code ?? "");
  const [reportsToId, setReportsToId] = useState(p?.reportsToId ?? "");
  const [isHead, setIsHead] = useState(p?.isHead ?? false);
  const [specialties, setSpecialties] = useState((p?.specialties ?? []).join("\n"));
  const [planned, setPlanned] = useState(String(p?.plannedCount ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!props.unit) return null;
  const unitName = localText(props.unit.nameAr, props.unit.nameEn, lang);
  const unitOf = new Map(props.units.map((u) => [u.id, u]));
  const choices = reportsToChoices(props.positions, p?.id ?? null).map((x) => ({
    value: x.id,
    label: localText(x.titleAr, x.titleEn, lang),
    hint: [x.code, localText(unitOf.get(x.unitId)?.nameAr ?? null, unitOf.get(x.unitId)?.nameEn ?? null, lang)].filter(Boolean).join(" · "),
  }));
  const heading = p ? t("editTitle", { title: localText(p.titleAr, p.titleEn, lang) }) : t("newTitle", { name: unitName });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fields = {
      titleAr: titleAr.trim() || null,
      titleEn: titleEn.trim() || null,
      reportsToId: reportsToId || null,
      isHead,
      specialties: parseSpecialties(specialties),
      plannedCount: Number(planned) || 1,
    };
    const r = p
      ? await callApi(`/api/org-chart/positions/${p.id}`, "PATCH", { ...fields, code: code.trim() })
      : await callApi(`/api/org-chart/units/${props.unit!.id}/positions`, "POST", { ...fields, code: code.trim() || null });
    setBusy(false);
    if (!r.ok) return setError(say(r));
    toast.success(tc("saved"));
    props.onSaved(p?.id ?? (r.data as { id: string }).id);
  }

  return (
    <Sheet open onOpenChange={(o) => (o ? null : props.onClose())}>
      <SheetContent side={side} showCloseButton={false} className="w-full overflow-y-auto sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <SheetHeader className="p-5 pb-0">
            <SheetTitle dir="auto">{heading}</SheetTitle>
            <SheetDescription dir="auto">{unitName}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-5">
            <div className="grid gap-2">
              <Label htmlFor="p-title-ar">{t("titleAr")}</Label>
              <Input id="p-title-ar" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} maxLength={ORG_CHART_LIMITS.name} dir="rtl" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-title-en">{t("titleEn")}</Label>
              <Input id="p-title-en" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} maxLength={ORG_CHART_LIMITS.name} dir="ltr" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="p-code">{t("code")}</Label>
                <Input id="p-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} dir="ltr" required={!!p} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-planned">{t("planned")}</Label>
                <Input
                  id="p-planned"
                  type="number"
                  inputMode="numeric"
                  min={ORG_CHART_LIMITS.planned.min}
                  max={ORG_CHART_LIMITS.planned.max}
                  value={planned}
                  onChange={(e) => setPlanned(e.target.value)}
                  required
                  dir="ltr"
                />
              </div>
            </div>
            {!p ? <p className="-mt-2 text-xs text-muted-foreground">{t("codeHint")}</p> : null}
            <div className="grid gap-2">
              <Label htmlFor="p-reports">{t("reportsTo")}</Label>
              <PersonPicker id="p-reports" options={choices} defaultValue={reportsToId || undefined} onValueChange={setReportsToId} placeholder={t("reportsToNone")} clearable />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={isHead} onCheckedChange={(v) => setIsHead(v === true)} className="mt-0.5" />
              <span>{t("head")}</span>
            </label>
            <div className="grid gap-2">
              <Label htmlFor="p-spec">{t("specialties")}</Label>
              <Textarea id="p-spec" value={specialties} onChange={(e) => setSpecialties(e.target.value)} rows={3} dir="auto" />
              <p className="text-xs text-muted-foreground">{t("specialtiesHint")}</p>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={props.onClose}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={busy || (!titleAr.trim() && !titleEn.trim())}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {tc("save")}
              </Button>
            </div>
          </div>
        </form>
        {p && props.names ? <HoldersReadOnly position={p} live={props.live} peopleHref={props.peopleHref} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/** Who holds a position, read only in the draft editor, with the way to where holders change. */
function HoldersReadOnly(props: { position: OrgPosition; live: boolean; peopleHref: string | null }) {
  const t = useTranslations("orgChart.editor");
  const tTree = useTranslations("orgChart.tree");
  const rtl = useLocale() === "ar";
  const names = props.position.holders.flatMap((h) => (h.named && h.name ? [h.name] : []));
  return (
    <section aria-labelledby={`ro-${props.position.id}`} className="grid gap-2 border-t p-5 text-sm">
      <h3 id={`ro-${props.position.id}`} className="font-semibold">
        {t("holdersTitle")}
      </h3>
      {props.live ? (
        <p dir="auto">{names.length ? names.join(rtl ? "، " : ", ") : props.position.vacant ? tTree("vacant") : "—"}</p>
      ) : (
        <p className="text-muted-foreground">{t("draftOnlyHolders")}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("holdersElsewhere")}{" "}
        {props.peopleHref ? (
          <Link href={props.peopleHref} className="text-foreground underline underline-offset-2">
            {t("holdersLink")}
          </Link>
        ) : null}
      </p>
    </section>
  );
}

/** "Move under another unit" (a unit: never under itself or its own units; or to the top) and "Move to another unit" (a position). */
function MoveDialog(props: { moving: NonNullable<Moving>; units: OrgUnit[]; positions: OrgPosition[]; onClose: () => void; onMove: (target: string | null) => Promise<void> }) {
  const t = useTranslations("orgChart.editor");
  const tc = useTranslations("common");
  const lang = useLocale() === "ar" ? "ar" : "en";
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const unit = props.moving.kind === "unit" ? props.units.find((u) => u.id === props.moving.id) : undefined;
  const position = props.moving.kind === "position" ? props.positions.find((p) => p.id === props.moving.id) : undefined;
  const blocked = unit ? unitAndBelow(props.units, unit.id) : new Set(position ? [position.unitId] : []);
  const TOP = "top";
  const options = [
    ...(unit && unit.parentId ? [{ value: TOP, label: t("top") }] : []),
    ...props.units
      .filter((u) => !blocked.has(u.id) && u.id !== unit?.parentId)
      .map((u) => ({ value: u.id, label: localText(u.nameAr, u.nameEn, lang), hint: u.code })),
  ];
  const name = unit ? localText(unit.nameAr, unit.nameEn, lang) : position ? localText(position.titleAr, position.titleEn, lang) : "";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    await props.onMove(target === TOP ? null : target);
    setBusy(false);
  }
  return (
    <Dialog open onOpenChange={(o) => (o ? null : props.onClose())}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle dir="auto">{unit ? t("moveUnderTitle", { name }) : t("moveToUnitTitle", { title: name })}</DialogTitle>
            <DialogDescription className="sr-only">{unit ? t("moveUnder") : t("moveToUnit")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="m-target">{unit ? t("newParent") : t("newUnit")}</Label>
            <PersonPicker id="m-target" options={options} onValueChange={setTarget} placeholder={unit ? t("newParent") : t("newUnit")} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !target}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("move")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

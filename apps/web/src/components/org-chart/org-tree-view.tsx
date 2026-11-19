"use client";

import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { panBy, toggled, toolKey, ZOOM_DEFAULT, ZOOM_STEPS, zoomIn, zoomOut, zoomPercent } from "@/lib/org-chart-reading";
import type { PersonWork } from "@/services/org-chart";

const NONE: ReadonlySet<string> = new Set();

/** The reading tools' inputs, from the server: the units that fold, and the departments to focus on (each with its address). */
export interface TreeTools {
  units: string[];
  focus: { current: string | null; whole: string; choices: { id: string; label: string; href: string }[] };
}

/**
 * The drawn structure on screen, with each holder who has a Selah account as
 * a button (lib/org-chart-html.ts, `people`). Pressing one (a click, Enter or
 * Space) opens that person's work card. The drawing itself is the same
 * escaped HTML as the PDF.
 *
 * The reading tools (part 5), on screen only: each unit's fold button
 * (collapse and expand), "collapse all" and "expand all", zoom out, in and
 * back to the drawing's size, panning by dragging the drawing or with the
 * arrow keys once it has the focus (+, − and 0 zoom), and focus on one
 * department (an address of its own, so the server draws only that unit).
 * Folding and zoom live in the page only; the PDF always prints what the
 * reader chose in its own dialog.
 */
export function OrgTreeView({ html, clientId, version, tools }: { html: string; clientId: string; version: string | null; tools?: TreeTools }) {
  const t = useTranslations("orgChart.reading");
  const router = useRouter();
  const [person, setPerson] = useState<string | null>(null);
  // The units folded, for this drawing only: another version, depth or focus starts unfolded.
  const [folds, setFolds] = useState<{ html: string; units: ReadonlySet<string> }>(() => ({ html, units: NONE }));
  const collapsed = folds.html === html ? folds.units : NONE;
  const setCollapsed = (next: ReadonlySet<string> | ((c: ReadonlySet<string>) => ReadonlySet<string>)) =>
    setFolds((f) => ({ html, units: typeof next === "function" ? next(f.html === html ? f.units : NONE) : next }));
  const [zoom, setZoom] = useState<number>(ZOOM_DEFAULT);
  const frame = useRef<HTMLDivElement>(null);
  const drawing = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);

  // The fold state onto the drawing: the server's HTML is never rebuilt in the browser, only marked.
  useEffect(() => {
    const root = drawing.current;
    if (!root) return;
    for (const li of root.querySelectorAll<HTMLElement>("li[data-unit]")) li.classList.toggle("oc-shut", collapsed.has(li.dataset.unit!));
    for (const b of root.querySelectorAll<HTMLButtonElement>("button[data-toggle]")) {
      const shut = collapsed.has(b.dataset.toggle!);
      b.setAttribute("aria-expanded", shut ? "false" : "true");
      const label = (shut ? b.dataset.expand : b.dataset.collapse) ?? "";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.textContent = shut ? "+" : "−";
    }
  }, [collapsed, html]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const fold = target.closest<HTMLElement>("[data-toggle]");
    if (fold?.dataset.toggle) return setCollapsed((c) => toggled(c, fold.dataset.toggle!));
    const button = target.closest<HTMLElement>("[data-person]");
    if (button?.dataset.person) setPerson(button.dataset.person);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Keys on a button inside (a name, a fold) are the button's own; the drawing reads keys only when it has the focus itself.
    if (!tools || e.target !== frame.current || e.altKey || e.ctrlKey || e.metaKey) return;
    const what = toolKey(e.key);
    if (!what) return;
    e.preventDefault();
    if (what === "in") setZoom(zoomIn);
    else if (what === "out") setZoom(zoomOut);
    else if (what === "reset") setZoom(ZOOM_DEFAULT);
    else frame.current.scrollBy({ ...panBy(e.key)!, behavior: "smooth" });
  }

  // Dragging the drawing's background pans it; a press on a button stays a press.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!tools || e.button !== 0 || (e.target as HTMLElement).closest("button, a") || !frame.current) return;
    drag.current = { x: e.clientX, y: e.clientY, left: frame.current.scrollLeft, top: frame.current.scrollTop, id: e.pointerId };
    frame.current.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !frame.current) return;
    // Scrolling is physical: the drawing follows the pointer the same way in Arabic and in English.
    frame.current.scrollLeft = d.left - (e.clientX - d.x);
    frame.current.scrollTop = d.top - (e.clientY - d.y);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  const all = tools?.units ?? [];
  return (
    <div className="grid gap-2">
      {tools ? (
        <div role="group" aria-label={t("label")} className="flex flex-wrap items-center gap-2 text-sm">
          {tools.focus.choices.length ? (
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("focus")}</span>
              <NativeSelect
                size="sm"
                value={tools.focus.current ?? ""}
                onChange={(e) => router.push(tools.focus.choices.find((c) => c.id === e.target.value)?.href ?? tools.focus.whole)}
              >
                <NativeSelectOption value="">{t("whole")}</NativeSelectOption>
                {tools.focus.choices.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          {all.length ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(all))}>
              {collapsed.size ? t("expandAll") : t("collapseAll")}
            </Button>
          ) : null}
          <div className="ms-auto flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setZoom(zoomOut)} disabled={zoom <= ZOOM_STEPS[0]} aria-label={t("zoomOut")} title={t("zoomOut")}>
              <Minus className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-w-14 tabular-nums" onClick={() => setZoom(ZOOM_DEFAULT)} aria-label={t("zoomReset")} title={t("zoomReset")}>
              {t("percent", { n: zoomPercent(zoom) })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setZoom(zoomIn)}
              disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!}
              aria-label={t("zoomIn")}
              title={t("zoomIn")}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
      {/* The buttons inside handle the keyboard themselves (Enter and Space click them); this only listens for their clicks. */}
      <div
        ref={frame}
        className={
          tools
            ? "max-h-[75vh] cursor-grab overflow-auto rounded-xl border bg-card p-5 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
            : "overflow-x-auto rounded-xl border bg-card p-5 shadow-xs"
        }
        tabIndex={tools ? 0 : undefined}
        role={tools ? "region" : undefined}
        aria-label={tools ? t("drawing") : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={drawing} style={tools ? { zoom } : undefined} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {tools ? <p className="text-xs text-muted-foreground">{t("keys")}</p> : null}
      {person ? <PersonWorkCard clientId={clientId} userId={person} version={version} onClose={() => setPerson(null)} /> : null}
    </div>
  );
}

type Loaded = { state: "loading" } | { state: "gone" } | { state: "failed" } | { state: "ok"; data: PersonWork };

/**
 * A person's work card: their open tasks, what is late, and their recent
 * uploads, each a link to the item. The server reads it as the person
 * looking (services/org-chart.ts personWork): only what they could already
 * open. It lists the work and says nothing about the person: no score,
 * count or colour.
 */
function PersonWorkCard({ clientId, userId, version, onClose }: { clientId: string; userId: string; version: string | null; onClose: () => void }) {
  const t = useTranslations("orgChart.card");
  const tc = useTranslations("common");
  const tStatus = useTranslations("status");
  const format = useFormatter();
  const ar = useLocale() === "ar";
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let live = true;
    const q = version ? `?version=${encodeURIComponent(version)}` : "";
    fetch(`/api/clients/${clientId}/structure/people/${userId}${q}`)
      .then(async (r) => {
        if (!live) return;
        if (r.status === 404) setLoaded({ state: "gone" });
        else if (!r.ok) setLoaded({ state: "failed" });
        else setLoaded({ state: "ok", data: (await r.json()) as PersonWork });
      })
      .catch(() => live && setLoaded({ state: "failed" }));
    return () => {
      live = false;
    };
  }, [clientId, userId, version]);

  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const data = loaded.state === "ok" ? loaded.data : null;
  const local = (a: string | null, e: string | null) => (ar ? (a ?? e) : (e ?? a)) ?? "";

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{data ? data.person.name : loaded.state === "loading" ? tc("loading") : "—"}</DialogTitle>
          <DialogDescription>
            {data
              ? data.person.positions.map((p) => [local(p.titleAr, p.titleEn), local(p.unitNameAr, p.unitNameEn)].filter(Boolean).join(" · ")).join(ar ? "، " : ", ")
              : t("hint")}
          </DialogDescription>
        </DialogHeader>
        {loaded.state === "loading" ? (
          <div className="flex justify-center py-6">
            <BrandLoader className="size-5" />
          </div>
        ) : null}
        {loaded.state === "gone" ? <p className="text-sm text-muted-foreground">{t("gone")}</p> : null}
        {loaded.state === "failed" ? (
          <p role="alert" className="text-sm text-destructive">
            {tc("errors.generic")}
          </p>
        ) : null}
        {data ? (
          <div className="grid gap-5 text-sm">
            <section aria-labelledby="wc-late" className="grid gap-2">
              <h3 id="wc-late" className="font-medium">
                {t("late")}
              </h3>
              {data.late.length ? (
                <ul className="grid gap-1.5">
                  {data.late.map((a) => (
                    <li key={a.id} className="grid">
                      <Link href={`/actions/${a.id}`} className="font-medium hover:underline" dir="auto">
                        {a.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {tStatus(a.status as never)} · {a.dueDate ? t("wasDue", { date: day(a.dueDate) }) : t("noDue")} · <bdi>{a.projectTitle}</bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("noLate")}</p>
              )}
              {data.moreLate ? <p className="text-xs text-muted-foreground">{t("more")}</p> : null}
            </section>
            <section aria-labelledby="wc-open" className="grid gap-2">
              <h3 id="wc-open" className="font-medium">
                {t("open")}
              </h3>
              {data.open.length ? (
                <ul className="grid gap-1.5">
                  {data.open.map((a) => (
                    <li key={a.id} className="grid">
                      <Link href={`/actions/${a.id}`} className="font-medium hover:underline" dir="auto">
                        {a.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {tStatus(a.status as never)} · {a.dueDate ? t("due", { date: day(a.dueDate) }) : t("noDue")} · <bdi>{a.projectTitle}</bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("noOpen")}</p>
              )}
              {data.moreOpen ? <p className="text-xs text-muted-foreground">{t("more")}</p> : null}
            </section>
            <section aria-labelledby="wc-uploads" className="grid gap-2">
              <h3 id="wc-uploads" className="font-medium">
                {t("uploads")}
              </h3>
              {data.uploads.length ? (
                <ul className="grid gap-1.5">
                  {data.uploads.map((f) => (
                    <li key={f.id} className="grid">
                      <Link href={f.href} className="font-medium hover:underline" dir="auto">
                        {f.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {t("uploaded", { date: format.dateTime(new Date(f.createdAt), { dateStyle: "medium" }) })} · <bdi>{f.where}</bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("noUploads")}</p>
              )}
            </section>
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

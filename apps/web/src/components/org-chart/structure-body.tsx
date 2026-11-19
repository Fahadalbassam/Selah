import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button-variants";
import { ORG_CHART_CSS, ORG_CHART_TOOLS_CSS, orgTreeHtml, treeLabels, versionWords } from "@/lib/org-chart-html";
import { collapsibleIds, focusChoices, focusTree } from "@/lib/org-chart-reading";
import { buildTree, chartLevels, parseDepth } from "@/lib/org-chart-tree";
import { cn } from "@/lib/utils";
import type { Structure } from "@/services/org-chart";
import { OrgTreeView } from "./org-tree-view";

/** The address of a version on the tab (the current one has none), with the depth when one is chosen and the unit focused on. */
function href(base: string, version: string | null, depth?: number | null, focus?: string | null) {
  const q = new URLSearchParams();
  if (version) q.set("version", version);
  if (depth) q.set("depth", String(depth));
  if (focus) q.set("focus", focus);
  return q.size ? `${base}?${q}` : base;
}

/** The address of one of the tab's views of a version (the drawing has none). */
export function viewHref(base: string, version: string | null, view: StructureView) {
  const q = new URLSearchParams();
  if (version) q.set("version", version);
  if (view !== "drawing") q.set("view", view);
  return q.size ? `${base}?${q}` : base;
}

/** The version shown, in the address: "draft", an id, or null for the current one. */
export function shownParam(structure: Structure): string | null {
  const v = structure.shown?.version;
  if (!v || v.id === structure.current?.id) return null;
  return v.state === "draft" ? "draft" : v.id;
}

/** The depth chosen in the address, for this version's levels. */
export function shownDepth(structure: Structure, raw: string | undefined) {
  const levels = chartLevels(structure.shown?.units ?? []);
  return { levels, depth: parseDepth(raw, levels) };
}

/** The tab's ways of showing the version: the drawing, the outline editor (the firm's draft) or the people in positions (the current version). */
export type StructureView = "drawing" | "outline" | "people";

/**
 * Which views the reader has for the version shown, and the one asked for in
 * the address (the first when it is not one of them). The outline is for the
 * firm's editors on the draft; the people in positions for whoever changes
 * holders, on the current version. An empty draft opens on the outline.
 */
export function structureViews(structure: Structure, raw: string | undefined): { views: StructureView[]; view: StructureView } {
  const v = structure.shown?.version;
  const views: StructureView[] = ["drawing"];
  if (v?.state === "draft" && structure.can.canEditDraft) views.push("outline");
  if (v?.state === "published" && structure.can.canChangeHolders) views.push("people");
  const asked = views.find((x) => x === raw);
  const fallback = v?.state === "draft" && structure.can.canEditDraft && !structure.shown?.units.length ? "outline" : "drawing";
  return { views, view: asked ?? fallback };
}

/**
 * The Structure tab under its header (firm side on the client page, client
 * side on the Departments page): which version this is and when it took
 * effect, the other versions, how many levels to show, and the drawing. The
 * drawing is the same HTML as the PDF (lib/org-chart-html.ts); every name in
 * it is one the services sent this reader, and on screen each holder with an
 * account opens their work card (part 3). The pages show it only once there
 * is a version to show (hasStructure()). With `view` other than the drawing,
 * the page's own panel (`children`: the outline editor, the people in
 * positions) takes the drawing's place.
 */
export async function StructureBody({
  structure,
  base,
  depthParam,
  focusParam,
  audience,
  view = "drawing",
  views = ["drawing"],
  children,
}: {
  structure: Structure;
  base: string;
  depthParam?: string;
  /** The department the drawing is focused on (a unit id in the address), or nothing for the whole structure. */
  focusParam?: string;
  audience: "firm" | "client";
  view?: StructureView;
  views?: StructureView[];
  children?: ReactNode;
}) {
  const [t, format, locale] = await Promise.all([getTranslations("orgChart"), getFormatter(), getLocale()]);
  const lang = locale === "ar" ? "ar" : "en";
  const shown = structure.shown;
  if (!shown) return null;

  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const v = shown.version;
  const draft = v.state === "draft";
  const { levels, depth } = shownDepth(structure, depthParam);
  const whole = buildTree(shown.units, shown.positions, { locale: lang, depth, names: true });
  // Focus on one department (part 5): only that unit is drawn; an id that is not one of the choices draws everything.
  const focused = focusTree(whole, focusParam);
  const roots = focused ?? whole;
  const focus = focused ? focusParam! : null;
  const tr = (k: string, values?: Record<string, string | number>) => t(k as "title", values as never);
  // A link to another version: "Draft", "Version 2, current", "Version 1 (in effect from …)", "Version 3 (takes effect on …)".
  const label = (x: Structure["versions"][number]) =>
    x.status.kind === "draft" ? t("version.draft") : x.status.kind === "current" ? t("version.current", { n: x.number ?? 0 }) : t("version.number", { n: x.number ?? 0 });
  const note = (x: Structure["versions"][number]) =>
    x.status.kind === "upcoming" ? t("version.upcoming", { date: day(x.status.on) }) : x.status.kind === "past" && x.effectiveOn ? day(x.effectiveOn) : null;
  // The same words as the PDF's heading, plus who published it.
  const meta = [
    ...versionWords(v, shown.status, shown.names !== "none" ? shown.asOf : null, tr, day),
    !draft && v.publishedAt ? t("version.published", { date: format.dateTime(v.publishedAt, { dateStyle: "medium" }), name: v.publishedByName ?? "—" }) : null,
  ];
  // The board resolution of this version, when the reader may open its file.
  const resolution = !draft && structure.resolution && structure.resolution.id === v.resolutionDocumentId ? structure.resolution : null;
  const others = structure.versions.filter((x) => x.id !== v.id);
  const param = shownParam(structure);
  // What the reader should know about the names, said once: never a name the page decides to hide.
  const namesNote = structure.client.minimalRecords
    ? t("names.minimal")
    : audience === "client" && shown.names === "branch"
      ? t("names.branch")
      : audience === "client" && shown.names === "none"
        ? v.state === "superseded"
          ? t("names.history")
          : !v.showNames
            ? t("names.hidden")
            : !structure.client.departmentsEnabled
              ? t("names.departmentsOff")
              : t("names.noDepartment")
        : null;

  return (
    <div className="space-y-4">
      {draft ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          {structure.current ? t("draftBanner") : `${t("draftBanner")} ${t("notPublished")}`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-sm">
          <p className="font-medium">{meta.filter(Boolean).join(" · ")}</p>
          {resolution ? (
            <p className="text-muted-foreground">
              {t("version.resolution")}{" "}
              <a href={`/api/documents/${resolution.id}/download`} className="text-foreground hover:underline" dir="auto">
                {resolution.title}
              </a>
            </p>
          ) : null}
          {others.length ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span>{t("version.others")}</span>
              {others.map((x) => (
                <Link key={x.id} href={href(base, x.state === "published" ? null : x.state === "draft" ? "draft" : x.id)} className="text-foreground hover:underline">
                  {label(x)}
                  {note(x) ? <span className="text-muted-foreground"> ({note(x)})</span> : null}
                </Link>
              ))}
            </p>
          ) : null}
          {namesNote ? <p className="text-muted-foreground">{namesNote}</p> : null}
        </div>
        {views.length > 1 ? (
          <nav aria-label={t("views.label")} className="flex items-center gap-1 text-sm">
            {views.map((x) => (
              <Link
                key={x}
                href={viewHref(base, param, x)}
                aria-current={x === view ? "page" : undefined}
                className={cn(buttonVariants({ variant: x === view ? "secondary" : "ghost", size: "sm" }))}
              >
                {t(`views.${x}`)}
              </Link>
            ))}
          </nav>
        ) : null}
        {view === "drawing" && levels.length > 1 ? (
          <nav aria-label={t("depth.label")} className="flex items-center gap-1 text-sm">
            <span className="me-1 text-muted-foreground">{t("depth.label")}</span>
            {[...levels.slice(0, -1), null].map((n) => (
              <Link
                key={n ?? "all"}
                href={href(base, param, n, focus)}
                aria-current={n === depth ? "true" : undefined}
                title={n === null ? undefined : t("depth.upTo", { n })}
                className={cn(buttonVariants({ variant: n === depth ? "secondary" : "ghost", size: "sm" }), "tabular-nums")}
              >
                {n === null ? t("depth.all") : new Intl.NumberFormat(locale).format(n)}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      {view !== "drawing" && children ? (
        children
      ) : roots.length ? (
        <>
          <style dangerouslySetInnerHTML={{ __html: ORG_CHART_CSS + ORG_CHART_TOOLS_CSS }} />
          {/* Escaped in orgTreeHtml: the same drawing the PDF prints, with a button on each name that has a work card and a fold button on each unit. */}
          <OrgTreeView
            html={orgTreeHtml(roots, treeLabels((k, values) => t(k as "title", values as never)), lang, { people: shown.names !== "none", tools: true })}
            clientId={structure.client.id}
            version={param}
            tools={{
              units: collapsibleIds(roots),
              focus: {
                current: focus,
                whole: href(base, param, depth),
                choices: focusChoices(whole).map((c) => ({ id: c.id, label: c.name, href: href(base, param, depth, c.id) })),
              },
            }}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("emptyDraft")}</p>
      )}
    </div>
  );
}

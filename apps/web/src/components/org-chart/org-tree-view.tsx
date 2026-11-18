"use client";

import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type MouseEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PersonWork } from "@/services/org-chart";

/**
 * The drawn structure on screen, with each holder who has a Selah account as
 * a button (lib/org-chart-html.ts, `people`). Pressing one (a click, Enter or
 * Space) opens that person's work card. The drawing itself is the same
 * escaped HTML as the PDF.
 */
export function OrgTreeView({ html, clientId, version }: { html: string; clientId: string; version: string | null }) {
  const [person, setPerson] = useState<string | null>(null);
  function open(e: MouseEvent<HTMLDivElement>) {
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-person]");
    if (button?.dataset.person) setPerson(button.dataset.person);
  }
  return (
    <>
      {/* The buttons inside handle the keyboard themselves (Enter and Space click them); this only listens for their clicks. */}
      <div className="overflow-x-auto rounded-xl border bg-card p-5 shadow-xs" onClick={open} dangerouslySetInnerHTML={{ __html: html }} />
      {person ? <PersonWorkCard clientId={clientId} userId={person} version={version} onClose={() => setPerson(null)} /> : null}
    </>
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

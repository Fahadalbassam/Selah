"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { AudienceMarker } from "@/components/audience-marker";
import { AudiencePicker, type AudienceChange } from "@/components/audience-picker";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  audienceRefusal,
  audienceToSave,
  reconcileAudience,
  type AudienceItemKind,
  type AudienceMode,
  type AudiencePerson,
  type AudienceSide,
} from "@/lib/audience";

// Who sees an item (feature A), wired to the server. The people come from the
// server and hold only those who can already see the item; which of them
// always see it is the server's answer too. The page never decides.

/** What a form sends for the audience: a mode and people, or nothing when it cannot be saved yet. */
export type AudienceValue = { mode: AudienceMode; people: string[] };

interface Source {
  owner: AudienceSide;
  people: AudiencePerson[];
  mode?: AudienceMode;
  selected?: string[];
}

/** The value a change saves: "everyone" when nobody is left out, or why it cannot be saved. */
export function audienceValue(change: AudienceChange): AudienceValue | null {
  if (!change.check.ok) return null;
  const v = change.check.value;
  return v ? { mode: v.mode, people: v.people } : { mode: "everyone", people: [] };
}

type Picks = { mode: AudienceMode; selected: string[] };

/** The value the picks save, or null while they cannot be saved. */
function valueOf(picks: Picks, people: readonly AudiencePerson[]): AudienceValue | null {
  const check = audienceToSave(
    picks.mode,
    picks.selected,
    people.filter((p) => p.locked).map((p) => p.id),
  );
  if (!check.ok) return null;
  return check.value ? { mode: check.value.mode, people: check.value.people } : { mode: "everyone", people: [] };
}

/**
 * The picker with its people from `url`: GET /api/documents/:id/audience (an
 * item), or /api/projects/:id/audience?kind=… (an item not saved yet, from
 * what the form says). `onChange` gets the value to send, or null while it
 * cannot be saved (an "only" list with nobody). Nothing is drawn until the
 * people arrive; if they cannot be read the form goes on without it. When the
 * form changes who can see the item (the label, the department, who is
 * invited), the people are asked again and any pick that no longer fits is
 * dropped, with one plain line saying who (review S5).
 */
export function AudienceField(props: {
  kind: AudienceItemKind;
  url: string;
  onChange: (value: AudienceValue | null, dirty: boolean) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
  id?: string;
}) {
  const t = useTranslations("audience");
  const locale = useLocale() === "en" ? "en" : "ar";
  const [source, setSource] = useState<Source | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<Picks | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  // The latest picks, people and callback, for the answer to a new request (read in effects only).
  const latest = useRef<{ picks: Picks | null; people: AudiencePerson[]; onChange: typeof props.onChange }>({ picks: null, people: [], onChange: props.onChange });
  useEffect(() => {
    latest.current.onChange = props.onChange;
  });

  useEffect(() => {
    let live = true;
    fetch(props.url)
      .then(async (res) => {
        // Not found: this person gets no picker here (a client manager, an action owner). Nothing is drawn.
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Source;
      })
      .then((s) => {
        if (!live || !s) return;
        const before = latest.current;
        // An item's saved audience is where the picker starts; a new item starts with everyone.
        let picks: Picks = before.picks ?? { mode: s.mode ?? "everyone", selected: s.selected ?? [] };
        if (before.picks) {
          const r = reconcileAudience(before.picks.mode, before.picks.selected, s.people);
          if (r.dropped.length) {
            picks = { mode: before.picks.mode === "except" && r.selected.length === 0 ? "everyone" : before.picks.mode, selected: r.selected };
            const known = new Map([...before.people, ...s.people].map((p) => [p.id, p]));
            setDropped(r.dropped.map((id) => known.get(id)).filter((p): p is AudiencePerson => !!p).map((p) => p.name[locale] || p.name.ar || p.name.en));
            before.onChange(valueOf(picks, s.people), true);
          }
        }
        latest.current = { ...before, picks, people: s.people };
        setSource(s);
        setState(picks);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [props.url, locale]);

  if (failed) return <p className="text-xs text-muted-foreground">{t("loadFailed")}</p>;
  if (!source || !state) return null;
  return (
    <div className="grid gap-1">
      <AudiencePicker
        kind={props.kind}
        owner={source.owner}
        mode={state.mode}
        people={source.people}
        selected={state.selected}
        disabled={props.disabled}
        defaultOpen={props.defaultOpen}
        id={props.id}
        onChange={(next) => {
          const picks = { mode: next.mode, selected: next.selected };
          latest.current = { ...latest.current, picks };
          setState(picks);
          setDropped([]);
          props.onChange(audienceValue(next), true);
        }}
      />
      {dropped.length ? <AudienceDropped names={dropped} /> : null}
    </div>
  );
}

/** One plain line: who was taken off the list because the form changed who can see the item. */
export function AudienceDropped({ names }: { names: string[] }) {
  const t = useTranslations("audience");
  const format = useFormatter();
  return (
    <p className="text-xs text-muted-foreground" role="status">
      {t("dropped", { names: format.list(names, { type: "conjunction" }) })}
    </p>
  );
}

/**
 * Who sees an item, on its details: the quiet line and the picker, with a
 * Save that appears once something changed. Only for the people who may
 * change it (the server answers 404 to anyone else).
 */
export function AudienceEditor({ kind, id, onSaved }: { kind: AudienceItemKind; id: string; onSaved?: () => void }) {
  const tc = useTranslations("common");
  const refusal = useAudienceRefusal();
  const router = useRouter();
  const [value, setValue] = useState<AudienceValue | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const url = `/api/${kind === "document" ? "documents" : "meetings"}/${id}/audience`;

  async function save() {
    if (!value) return;
    setBusy(true);
    const r = await callApi(url, "PUT", value);
    setBusy(false);
    if (!r.ok) return void toast.error(refusal(r.message) ?? tc(`errors.${r.error}`));
    toast.success(tc("saved"));
    setDirty(false);
    setRound((n) => n + 1);
    if (onSaved) onSaved();
    else router.refresh();
  }

  return (
    <div className="grid gap-2">
      <AudienceField
        key={round}
        kind={kind}
        url={url}
        onChange={(v, d) => {
          setValue(v);
          setDirty(d);
        }}
        disabled={busy}
      />
      {dirty ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={save} disabled={busy || !value}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {busy ? tc("saving") : tc("save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The sentence for a refusal of the server about an audience, in the
 * reader's language, or null when the refusal is about something else. Every
 * form that sends an audience says these plainly, never a generic error.
 */
export function useAudienceRefusal() {
  const t = useTranslations("audience.errors");
  return (message: string | null | undefined): string | null => {
    const why = audienceRefusal(message);
    return why ? t(why) : null;
  };
}

/** "Limited audience" for the people who still see a narrowed item; nothing otherwise. */
export function LimitedMarker({ kind, limited, className }: { kind: AudienceItemKind; limited: boolean; className?: string }) {
  return limited ? <AudienceMarker kind={kind} className={className} /> : null;
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AudienceMarker } from "@/components/audience-marker";
import { AudiencePicker, type AudienceChange } from "@/components/audience-picker";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { AudienceItemKind, AudienceMode, AudiencePerson, AudienceSide } from "@/lib/audience";

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

/**
 * The picker with its people from `url`: GET /api/documents/:id/audience (an
 * item), or /api/projects/:id/audience?kind=… (an item not saved yet, from
 * what the form says). `onChange` gets the value to send, or null while it
 * cannot be saved (an "only" list with nobody). Nothing is drawn until the
 * people arrive; if they cannot be read the form goes on without it.
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
  const [source, setSource] = useState<Source | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<{ mode: AudienceMode; selected: string[] } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(props.url)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Source;
      })
      .then((s) => {
        if (!live) return;
        setSource(s);
        setFailed(false);
        // An item's saved audience is where the picker starts; a new item starts with everyone.
        setState((cur) => cur ?? { mode: s.mode ?? "everyone", selected: s.selected ?? [] });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [props.url]);

  if (failed) return <p className="text-xs text-muted-foreground">{t("loadFailed")}</p>;
  if (!source || !state) return null;
  return (
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
        setState({ mode: next.mode, selected: next.selected });
        props.onChange(audienceValue(next), true);
      }}
    />
  );
}

/**
 * Who sees an item, on its details: the quiet line and the picker, with a
 * Save that appears once something changed. Only for the people who may
 * change it (the server answers 404 to anyone else).
 */
export function AudienceEditor({ kind, id, onSaved }: { kind: AudienceItemKind; id: string; onSaved?: () => void }) {
  const tc = useTranslations("common");
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
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
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

/** "Limited audience" for the people who still see a narrowed item; nothing otherwise. */
export function LimitedMarker({ kind, limited, className }: { kind: AudienceItemKind; limited: boolean; className?: string }) {
  return limited ? <AudienceMarker kind={kind} className={className} /> : null;
}

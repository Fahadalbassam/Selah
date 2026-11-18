"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Users } from "@/components/animate-ui/icons/users";
import { PersonOptionText, usePersonMatch } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  audienceGroups,
  audienceMode,
  audienceSelection,
  audienceToSave,
  switchAudience,
  type AudienceCheck,
  type AudienceGroup,
  type AudienceItemKind,
  type AudienceMode,
  type AudiencePerson,
  type AudienceSide,
  type AudienceSwitch,
} from "@/lib/audience";

export interface AudienceChange {
  mode: AudienceMode;
  /** Left out ("except"), or everyone who sees it ("only", locked people first). */
  selected: string[];
  /** The value to save, or why it cannot be saved yet. */
  check: AudienceCheck;
}

export interface AudiencePickerProps {
  /** What the item is, for the wording. */
  kind: AudienceItemKind;
  /**
   * Whose item it is. On a client's item only the client's own people can be
   * taken off (the firm's team always sees it), so firm people are not offered.
   */
  owner?: AudienceSide;
  mode: AudienceMode;
  /** The people who can already see the item, from the server. Nobody else can be picked. */
  people: AudiencePerson[];
  /** The people left out ("except"), or the people who see it ("only"). */
  selected: string[];
  onChange: (next: AudienceChange) => void;
  disabled?: boolean;
  /** Start opened rather than as the one quiet line. */
  defaultOpen?: boolean;
  /** For a label's htmlFor: the typing field. */
  id?: string;
}

/**
 * Who sees an item: "everyone with access, except…" (the default) or "only
 * these people…". It can only take people away from those the other rules
 * already let in, and it never fetches: the server hands it the people who
 * can see the item. Closed, it is one quiet line; opened, a two-way switch and
 * one list of chips, grouped Firm and Client. Locked people can never be left
 * out: they are not offered for "except" and stay as fixed chips for "only".
 * Controlled: the parent keeps `mode` and `selected` and saves `check.value`.
 */
export function AudiencePicker(props: AudiencePickerProps) {
  const t = useTranslations("audience");
  const tc = useTranslations("common");
  const locale = useLocale() === "en" ? "en" : "ar";
  const autoId = useId();
  const inputId = props.id ?? `${autoId}-input`;
  const errorId = `${autoId}-error`;
  const anchor = useRef<HTMLDivElement>(null);
  const matches = usePersonMatch();
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  const owner = props.owner ?? "firm";
  const groups = audienceGroups(props.people, owner);
  const people = groups.flatMap((g) => g.items);
  const byId = new Map(people.map((p) => [p.id, p]));
  const locked = people.filter((p) => p.locked).map((p) => p.id);
  const known = props.selected.filter((id) => byId.has(id));
  const position: AudienceSwitch = props.mode === "only" ? "only" : "except";
  const selected = audienceSelection(props.mode, known, locked);
  const check = audienceToSave(props.mode, known, locked);
  // What each position held in this session, so moving the switch back restores it.
  const remembered = useRef<Partial<Record<AudienceSwitch, readonly string[]>>>({ [position]: selected });

  const nameOf = (p: AudiencePerson) => p.name[locale] || p.name[locale === "ar" ? "en" : "ar"];
  // On the client's own item the reader is at the client: its admin is "your company's admin".
  const lockText = (reason: NonNullable<AudiencePerson["locked"]>) =>
    reason === "clientAdmin" && owner === "client" ? t("locked.clientAdminYours") : t(`locked.${reason}`);
  const emit = (mode: AudienceMode, ids: string[]) => {
    remembered.current[mode === "only" ? "only" : "except"] = ids;
    props.onChange({ mode, selected: ids, check: audienceToSave(mode, ids, locked) });
  };
  const pick = (value: AudiencePerson[]) => {
    // Whatever the keys did (Backspace in the empty field removes the last chip), locked people stay.
    const ids = audienceSelection(position, value.map((p) => p.id), locked);
    emit(audienceMode(position, ids, locked), ids);
  };
  const flip = (to: string) => {
    if ((to !== "except" && to !== "only") || to === position) return;
    remembered.current[position] = selected;
    const next = switchAudience(to, remembered.current, locked);
    emit(next.mode, next.selected);
  };

  const value = selected.map((id) => byId.get(id)).filter((p): p is AudiencePerson => !!p);

  const summary = !check.ok
    ? t("summary.nobody")
    : check.value === null
      ? t("summary.everyone")
      : t(`summary.${check.value.mode}`, { n: check.value.people.length });

  return (
    // The list portals into this outer box: inside any dialog (its focus trap lets the list be
    // clicked) but outside the collapsible panel, which clips what overflows it.
    <div ref={anchor} className="relative" data-slot="audience-picker">
      <Collapsible open={open} onOpenChange={setOpen} className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0" aria-hidden />
          <span data-slot="audience-summary">{summary}</span>
          <span aria-hidden>·</span>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="link" size="xs" className="h-auto px-0 text-sm">
              {open ? t("hide") : t("customise")}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="grid gap-3 rounded-lg border p-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={position}
              onValueChange={flip}
              disabled={props.disabled}
              aria-label={t("switchLabel", { kind: props.kind })}
              className="flex-wrap"
            >
              <ToggleGroupItem value="except">{t("position.except")}</ToggleGroupItem>
              <ToggleGroupItem value="only">{t("position.only")}</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">{t(`hint.${position}`, { kind: props.kind })}</p>

            <div className="w-full">
              <Combobox
                multiple
                items={groups}
                value={value}
                onValueChange={pick}
                itemToStringLabel={nameOf}
                itemToStringValue={(p: AudiencePerson) => p.id}
                isItemEqualToValue={(a: AudiencePerson, b: AudiencePerson) => a.id === b.id}
                filter={(p: AudiencePerson, query: string) => matches([p.name.ar, p.name.en, p.hint], query)}
                onOpenChange={(isOpen, details) => {
                  // Stay open after a pick, so several people can be picked in a row.
                  if (!isOpen && details.reason === "item-press") details.cancel();
                }}
                disabled={props.disabled}
              >
                <ComboboxChips aria-label={value.length > 0 ? t(`chips.${position}`) : undefined}>
                  <ComboboxValue>
                    {(chosen: AudiencePerson[]) => (
                      <>
                        {chosen.map((p) =>
                          p.locked ? (
                            <Tooltip key={p.id}>
                              <TooltipTrigger asChild>
                                <ComboboxChip removable={false} aria-label={nameOf(p)} aria-description={lockText(p.locked)} data-locked={p.locked}>
                                  <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                                  <span className="truncate">{nameOf(p)}</span>
                                </ComboboxChip>
                              </TooltipTrigger>
                              <TooltipContent>{lockText(p.locked)}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <ComboboxChip key={p.id} aria-label={nameOf(p)} aria-description={t("chipDescription")}>
                              <span className="truncate">{nameOf(p)}</span>
                              <ComboboxChipRemove aria-label={t("remove", { name: nameOf(p) })} />
                            </ComboboxChip>
                          ),
                        )}
                        <ComboboxChipsInput
                          id={inputId}
                          placeholder={t(`placeholder.${position}`)}
                          aria-invalid={!check.ok || undefined}
                          aria-describedby={!check.ok ? errorId : undefined}
                          aria-description={chosen.length > 0 ? t("inputDescription", { n: chosen.length }) : undefined}
                          onKeyDown={(event) => {
                            // Base UI empties the whole list on Escape while the list is shut; here that
                            // would quietly let everyone back in. Escape only closes (the list, or the dialog).
                            if (event.key === "Escape" && event.currentTarget.getAttribute("aria-expanded") !== "true") event.preventBaseUIHandler();
                          }}
                        />
                      </>
                    )}
                  </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent container={anchor}>
                  <ComboboxEmpty>{tc("noMatch")}</ComboboxEmpty>
                  <ComboboxList>
                    {(group: AudienceGroup) => (
                      <ComboboxGroup key={group.side} items={group.items} data-side={group.side}>
                        <ComboboxGroupLabel>{t(`groups.${group.label}`)}</ComboboxGroupLabel>
                        <ComboboxCollection>
                          {(p: AudiencePerson) => (
                            // A locked person cannot be picked; the reason stays readable (no dimming), with a lock.
                            <ComboboxItem key={p.id} value={p} disabled={!!p.locked} className="data-[disabled]:opacity-100" data-locked={p.locked}>
                              {p.locked ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                              <PersonOptionText label={nameOf(p)} hint={p.locked ? lockText(p.locked) : p.hint} />
                            </ComboboxItem>
                          )}
                        </ComboboxCollection>
                      </ComboboxGroup>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
            {owner === "client" ? <p className="text-xs text-muted-foreground">{t("clientOwned", { kind: props.kind })}</p> : null}
          </div>
        </CollapsibleContent>

        {!check.ok ? (
          <p id={errorId} className="text-xs text-destructive" role="alert">
            {t(`errors.${check.error}`)}
          </p>
        ) : null}
      </Collapsible>
    </div>
  );
}

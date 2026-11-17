"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxFilter,
} from "@/components/ui/combobox";

export interface PersonOption {
  value: string;
  label: string;
  /** Shown under the name and searched too: an email, a role. */
  hint?: string;
}

/**
 * How a typed query matches a person: any of their texts (a name in either
 * language, an email), without regard to case or accents.
 */
export function usePersonMatch() {
  const { contains } = useComboboxFilter({ sensitivity: "base" });
  return (texts: readonly (string | undefined)[], query: string) => texts.some((text) => !!text && contains(text, query));
}

/** A person in a picker's list: the name, and the hint under it. */
export function PersonOptionText({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="grid min-w-0">
      <span className="truncate">{label}</span>
      {hint ? (
        <span className="truncate text-xs text-muted-foreground" dir="auto">
          {hint}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Pick one person from a list that can run long (the firm's consultants, a
 * client's staff): type part of a name or email to narrow it. Arabic and
 * English match without regard to case or accents. The chosen id is posted
 * under `name`, like a select. To pick several, see `AudiencePicker`, built
 * the same way on the combobox's chips.
 */
export function PersonPicker(props: {
  id?: string;
  name?: string;
  options: PersonOption[];
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  /** Called with the chosen id, or "" when cleared. */
  onValueChange?: (value: string) => void;
  /** Offer a clear button (for optional pickers). */
  clearable?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("common");
  const anchor = useRef<HTMLDivElement>(null);
  const matches = usePersonMatch();
  const [value, setValue] = useState<PersonOption | null>(() => props.options.find((o) => o.value === props.defaultValue) ?? null);
  return (
    <div ref={anchor} className="w-full">
      <Combobox
        items={props.options}
        value={value}
        onValueChange={(v: PersonOption | null) => {
          setValue(v);
          props.onValueChange?.(v?.value ?? "");
        }}
        itemToStringLabel={(o: PersonOption) => o.label}
        itemToStringValue={(o: PersonOption) => o.value}
        isItemEqualToValue={(a: PersonOption, b: PersonOption) => a.value === b.value}
        filter={(o: PersonOption, query: string) => matches([o.label, o.hint], query)}
        name={props.name}
        required={props.required}
        disabled={props.disabled}
      >
        <ComboboxInput id={props.id} placeholder={props.placeholder ?? t("searchPeople")} showClear={props.clearable && !!value} clearLabel={t("clear")} />
        {/* Inside the dialog, so its focus trap lets the list be clicked. */}
        <ComboboxContent container={anchor}>
          <ComboboxEmpty>{t("noMatch")}</ComboboxEmpty>
          <ComboboxList>
            {(o: PersonOption) => (
              <ComboboxItem key={o.value} value={o}>
                <PersonOptionText label={o.label} hint={o.hint} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

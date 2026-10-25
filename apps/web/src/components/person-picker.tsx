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
 * Pick one person from a list that can run long (the firm's consultants, a
 * client's staff): type part of a name or email to narrow it. Arabic and
 * English match without regard to case or accents. The chosen id is posted
 * under `name`, like a select.
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
  const { contains } = useComboboxFilter({ sensitivity: "base" });
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
        filter={(o: PersonOption, query: string) => contains(o.label, query) || (!!o.hint && contains(o.hint, query))}
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
                <span className="grid min-w-0">
                  <span className="truncate">{o.label}</span>
                  {o.hint ? (
                    <span className="truncate text-xs text-muted-foreground" dir="auto">
                      {o.hint}
                    </span>
                  ) : null}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

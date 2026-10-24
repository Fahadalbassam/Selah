"use client"

import * as React from "react"
import { CalendarIcon, XIcon } from "lucide-react"
import { useFormatter, useLocale } from "next-intl"
import { arSA } from "react-day-picker/locale/ar-SA"
import { enUS } from "react-day-picker/locale/en-US"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/** YYYY-MM-DD in local time: due dates are calendar dates, not instants. */
function toIso(date: Date) {
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${m}-${d}`
}

function fromIso(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y = 0, m = 1, d = 1] = value.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/**
 * A date field: a button that opens the calendar in a popover. It posts its
 * value as YYYY-MM-DD through a hidden input named `name`, so it drops into
 * an ordinary form like a native date input would.
 */
function DatePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  placeholder,
  required,
  clearLabel,
  disabled,
  className,
}: {
  id?: string
  name?: string
  value?: string
  defaultValue?: string
  onChange?: (value: string | undefined) => void
  placeholder: string
  required?: boolean
  clearLabel?: string
  disabled?: React.ComponentProps<typeof Calendar>["disabled"]
  className?: string
}) {
  const locale = useLocale()
  const format = useFormatter()
  const [open, setOpen] = React.useState(false)
  const [inner, setInner] = React.useState(defaultValue)
  // A required date left empty: the button shows it, since the field the form checks is hidden.
  const [invalid, setInvalid] = React.useState(false)
  const current = value ?? inner
  const selected = fromIso(current)

  function set(next: string | undefined) {
    if (value === undefined) setInner(next)
    setInvalid(false)
    onChange?.(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            data-empty={!selected}
            aria-invalid={invalid || undefined}
            className="w-full justify-start font-normal data-[empty=true]:text-muted-foreground"
          >
            <CalendarIcon />
            {selected
              ? format.dateTime(selected, { dateStyle: "medium" })
              : placeholder}
          </Button>
        </PopoverTrigger>
        {selected && clearLabel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={clearLabel}
            className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => set(undefined)}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start">
        <Calendar
          mode="single"
          // Picking the chosen day again keeps it; the clear button empties the field.
          required
          selected={selected}
          defaultMonth={selected}
          dir={locale === "ar" ? "rtl" : "ltr"}
          locale={locale === "ar" ? arSA : enUS}
          disabled={disabled}
          onSelect={(date) => {
            set(date ? toIso(date) : undefined)
            setOpen(false)
          }}
        />
      </PopoverContent>
      {name ? (
        <input
          type="text"
          name={name}
          value={current ?? ""}
          required={required}
          // Not readOnly: read-only inputs skip `required` validation.
          onChange={() => {}}
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onFocus={() => setOpen(true)}
          onInvalid={() => setInvalid(true)}
        />
      ) : null}
    </Popover>
  )
}

export { DatePicker }

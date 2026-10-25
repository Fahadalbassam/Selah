"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { Combobox as ComboboxPrimitive } from "@animate-ui/react/primitives/base-ui/combobox"

import { cn } from "@/lib/utils"

/**
 * Animate UI's Combobox (Base UI), styled like our Select. A typed filter
 * over a long list: people pickers and the like. Inside a Radix dialog, pass
 * the dialog's element as `container` so the list stays clickable.
 */
const Combobox = ComboboxPrimitive.Root

function ComboboxInput({
  className,
  showClear = false,
  clearLabel,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input> & { showClear?: boolean; clearLabel?: string }) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className="relative flex w-full items-center"
    >
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-field bg-transparent ps-3 pe-16 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30",
          className
        )}
        {...props}
      />
      <div className="absolute end-1.5 flex items-center gap-0.5">
        {showClear ? (
          <ComboboxPrimitive.Clear
            aria-label={clearLabel}
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <XIcon className="size-3.5" />
          </ComboboxPrimitive.Clear>
        ) : null}
        <ComboboxPrimitive.Trigger
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronDownIcon className="size-4 opacity-50" />
        </ComboboxPrimitive.Trigger>
      </div>
    </ComboboxPrimitive.InputGroup>
  )
}

function ComboboxContent({
  className,
  container,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Popup> & {
  container?: React.ComponentProps<typeof ComboboxPrimitive.Portal>["container"]
}) {
  return (
    <ComboboxPrimitive.Portal container={container}>
      <ComboboxPrimitive.Positioner sideOffset={4} className="z-50 outline-none">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "max-h-[min(var(--available-height),18rem)] w-(--anchor-width) min-w-[12rem] origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            className
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={cn("outline-none", className)} {...props} />
}

function ComboboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 ps-2 pe-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      <span className="absolute end-2 flex size-3.5 items-center justify-center">
        <ComboboxPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </ComboboxPrimitive.ItemIndicator>
      </span>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-2 py-1.5 text-sm text-muted-foreground empty:hidden", className)}
      {...props}
    />
  )
}

const useComboboxFilter = ComboboxPrimitive.useFilter

export { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, useComboboxFilter }

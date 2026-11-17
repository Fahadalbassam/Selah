"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { Direction } from "radix-ui"
import { DirectionProvider } from "@base-ui/react/direction-provider"
import { Combobox as ComboboxPrimitive } from "@animate-ui/react/primitives/base-ui/combobox"

import { cn } from "@/lib/utils"

/**
 * Animate UI's Combobox (Base UI), styled like our Select. A typed filter
 * over a long list: people pickers and the like. Inside a Radix dialog, pass
 * the dialog's element as `container` so the list stays clickable.
 *
 * With `multiple`, the picks show as chips: put `ComboboxChips` where the
 * input would go, and inside it a `ComboboxValue` that renders one
 * `ComboboxChip` per pick (with a `ComboboxChipRemove` unless it must stay)
 * followed by `ComboboxChipsInput`. Backspace in the empty input removes the
 * last chip; the arrow keys move between chips in the reading direction;
 * Backspace or Delete removes the focused chip; Enter picks from the list.
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

/** A titled section of the list (items given as `[{ items: [...] }, ...]`). */
function ComboboxGroup({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Group>) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={cn("pb-1 last:pb-0", className)} {...props} />
}

function ComboboxGroupLabel({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.GroupLabel>) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground select-none", className)}
      {...props}
    />
  )
}

/**
 * The box of a `multiple` combobox: the chips, then the input, wrapping onto
 * more lines as picks are added. The list opens under it, as wide as it.
 * Base UI takes the reading direction for the arrow keys from its own
 * provider, so the page's (Radix) direction is handed on here.
 */
function ComboboxChips({ className, children, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Chips>) {
  const dir = Direction.useDirection()
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-chips"
      className={cn(
        "flex min-h-9 w-full cursor-text items-center rounded-md border border-field bg-transparent px-1.5 py-1 text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive/20 dark:bg-input/30",
        className
      )}
    >
      <DirectionProvider direction={dir}>
        <ComboboxPrimitive.Chips className="flex w-full min-w-0 flex-wrap items-center gap-1" {...props}>
          {children}
        </ComboboxPrimitive.Chips>
      </DirectionProvider>
    </ComboboxPrimitive.InputGroup>
  )
}

/**
 * One pick. A chip that must stay (`removable={false}`) takes no
 * `ComboboxChipRemove` and ignores Backspace and Delete. The owner of the
 * value must still refuse the removal: Backspace in the empty input removes
 * the last chip, whichever it is.
 */
function ComboboxChip({
  className,
  removable = true,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Chip> & { removable?: boolean }) {
  return (
    <ComboboxPrimitive.Chip
      {...props}
      // After the props, so a wrapping trigger (a tooltip's, say) keeps the chip's own slot name.
      data-slot="combobox-chip"
      data-removable={removable ? undefined : "false"}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 cursor-default items-center gap-1 rounded-md border border-border bg-muted ps-2 pe-0.5 text-xs font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-disabled:opacity-50 data-[removable=false]:pe-2",
        className
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!removable && (event.key === "Backspace" || event.key === "Delete")) {
          event.preventDefault()
          event.preventBaseUIHandler()
        }
      }}
    />
  )
}

/** The chip's remove button. Give it an `aria-label` naming the pick ("Remove Sara"). */
function ComboboxChipRemove({ className, children, ...props }: React.ComponentProps<typeof ComboboxPrimitive.ChipRemove>) {
  return (
    <ComboboxPrimitive.ChipRemove
      data-slot="combobox-chip-remove"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none",
        className
      )}
      {...props}
    >
      {children ?? <XIcon className="size-3" />}
    </ComboboxPrimitive.ChipRemove>
  )
}

/** The typing field after the chips, inside `ComboboxChips`. */
function ComboboxChipsInput({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chips-input"
      className={cn(
        "h-7 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

/** Renders the current value; with `multiple`, its child is a function of the picks. */
const ComboboxValue = ComboboxPrimitive.Value
/** The items of one `ComboboxGroup`, as a function of each item. */
const ComboboxCollection = ComboboxPrimitive.Collection

const useComboboxFilter = ComboboxPrimitive.useFilter

export {
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
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxFilter,
}

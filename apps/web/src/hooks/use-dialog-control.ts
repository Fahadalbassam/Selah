"use client";

import { useState, type RefObject } from "react";

/**
 * A dialog opened by something other than its own button, such as an item
 * of a row menu: the caller holds whether it is open, and names the control
 * the focus goes back to when it closes (the menu item is gone by then, and
 * the focus would otherwise land on the page itself).
 */
export interface DialogControl {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocus?: RefObject<HTMLElement | null>;
}

/** The dialog's open state (its own, or the caller's) and the props for its content. */
export function useDialogControl(control?: DialogControl, defaultOpen = false) {
  const [own, setOwn] = useState(defaultOpen);
  const open = control?.open ?? own;
  const setOpen = (next: boolean) => (control?.onOpenChange ? control.onOpenChange(next) : setOwn(next));
  const onCloseAutoFocus = (e: Event) => {
    const el = control?.returnFocus?.current;
    if (!el) return;
    e.preventDefault();
    el.focus();
  };
  return { open, setOpen, contentProps: { onCloseAutoFocus } };
}

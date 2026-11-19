"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { callApi } from "@/components/form-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { IconTip } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import type { DialogControl } from "@/hooks/use-dialog-control";
import { cn } from "@/lib/utils";

export interface RowMenuItem {
  key: string;
  label: string;
  /** What the server said this person may do with this row. Not allowed: not drawn, and its dialog is not mounted. */
  allowed: boolean;
  /** Removes or ends something: drawn last, after a line, in the problem colour. */
  destructive?: boolean;
  /** Asked first ("are you sure?"), in the shared confirmation dialog. */
  confirm?: string;
  /** A step that needs no form (see useRowCall), run once confirmed. */
  onSelect?: () => void;
  /** Or a dialog the menu opens, told when it is open and where the focus goes back to. */
  dialog?: (control: Required<DialogControl>) => ReactNode;
}

/**
 * The menu (⋯) at the end of a dense row (page audit U15): the row's rare
 * actions, so the row shows at most one button of its own. The trigger says
 * what it is for ("More for <name>"); it opens with Enter, Space or the
 * arrow keys, follows the reading direction, and the focus comes back to it
 * when a dialog or a confirmation opened from it closes. Draws nothing when
 * nothing is allowed.
 */
export function RowMenu({ label, items, className }: { label: string; items: RowMenuItem[]; className?: string }) {
  const locale = useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm(trigger);
  const shown = items.filter((i) => i.allowed);
  if (!shown.length) return null;

  async function choose(i: RowMenuItem) {
    if (i.dialog) return setOpened(i.key);
    if (i.confirm && !(await confirm(i.confirm))) return;
    i.onSelect?.();
  }

  const plain = shown.filter((i) => !i.destructive);
  const ending = shown.filter((i) => i.destructive);
  const entry = (i: RowMenuItem) => (
    <DropdownMenuItem key={i.key} variant={i.destructive ? "destructive" : "default"} onSelect={() => void choose(i)}>
      {i.label}
    </DropdownMenuItem>
  );
  return (
    <>
      <DropdownMenu dir={locale === "ar" ? "rtl" : "ltr"}>
        <DropdownMenuTrigger asChild>
          <IconTip name="moreMenu">
            <Button ref={trigger} type="button" variant="ghost" size="icon" className={cn("size-7 shrink-0", className)} aria-label={label}>
              <Ellipsis className="size-4" />
            </Button>
          </IconTip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {plain.map(entry)}
          {plain.length && ending.length ? <DropdownMenuSeparator /> : null}
          {ending.map(entry)}
        </DropdownMenuContent>
      </DropdownMenu>
      {shown.map((i) =>
        i.dialog ? <Fragment key={i.key}>{i.dialog({ open: opened === i.key, onOpenChange: (o) => setOpened(o ? i.key : null), returnFocus: trigger })}</Fragment> : null,
      )}
      {confirmDialog}
    </>
  );
}

/**
 * A menu item's call to one API route, as ApiButton does for a button: it
 * refreshes the page when it worked and says a failure in a toast (the menu
 * that held the item has closed).
 */
export function useRowCall() {
  const tc = useTranslations("common");
  const router = useRouter();
  return async function run(call: { endpoint: string; method?: string; body?: unknown; done?: string }) {
    const r = await callApi(call.endpoint, call.method ?? "POST", call.body);
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    if (call.done) toast.success(call.done);
    router.refresh();
  };
}

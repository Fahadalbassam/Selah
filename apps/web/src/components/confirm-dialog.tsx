"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The one confirmation step (shadcn/ui AlertDialog), in place of the
 * browser's own confirm box, which ignores the theme and reading direction.
 * Render `dialog` once in the component; `await confirm(text)` resolves to
 * the person's answer. Asked from a menu item, pass the menu's button as
 * `returnFocus`: the item is gone once the menu closes, and the focus goes
 * back to that button instead of the top of the page.
 */
export function useConfirm(returnFocus?: RefObject<HTMLElement | null>): [(message: string) => Promise<boolean>, ReactNode] {
  const t = useTranslations("common");
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((text: string) => {
    setMessage(text);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function close(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    setMessage(null);
  }

  const dialog = (
    <AlertDialog open={message !== null} onOpenChange={(open) => (open ? null : close(false))}>
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          const el = returnFocus?.current;
          if (!el?.isConnected) return;
          e.preventDefault();
          el.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => close(true)}>{t("continue")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [confirm, dialog];
}

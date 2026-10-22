"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef, useState, type ReactNode } from "react";
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
 * the person's answer.
 */
export function useConfirm(): [(message: string) => Promise<boolean>, ReactNode] {
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
      <AlertDialogContent>
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

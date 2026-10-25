"use client";

import { CopyButton as CopyPrimitive, CopyButtonIcon } from "@animate-ui/react/primitives/buttons/copy";
import type { VariantProps } from "class-variance-authority";
import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/**
 * Copies a value to the clipboard (Animate UI Copy Button): the copy icon turns
 * into a check for a moment, then back. With `children`, the label sits next
 * to the icon; without, it is an icon button named by `label`.
 */
export function CopyButton({
  content,
  label,
  children,
  onCopied,
  variant = "ghost",
  size,
  className,
}: {
  content: string;
  label: string;
  children?: ReactNode;
  onCopied?: () => void;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  return (
    <CopyPrimitive
      type="button"
      content={content}
      aria-label={children ? undefined : label}
      title={label}
      onCopiedChange={(copied) => copied && onCopied?.()}
      className={cn(buttonVariants({ variant, size: size ?? (children ? "default" : "icon") }), className)}
    >
      <CopyButtonIcon icon={<Copy />} copiedIcon={<Check />} />
      {children}
    </CopyPrimitive>
  );
}

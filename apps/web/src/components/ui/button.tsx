"use client"

import * as React from "react"
import type { VariantProps } from "class-variance-authority"
import { Button as ButtonPrimitive, type ButtonProps as ButtonPrimitiveProps } from "@animate-ui/react/primitives/buttons/button"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button-variants"

// shadcn's Button on Animate UI's button primitive: it answers a press with
// a quick spring to 97% (none under reduced motion). Same props as before.
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const primitive = {
    "data-slot": "button",
    "data-variant": variant,
    "data-size": size,
    asChild,
    className: cn(buttonVariants({ variant, size, className })),
    ...props,
  } as ButtonPrimitiveProps
  return <ButtonPrimitive {...primitive} />
}

export { Button, buttonVariants }

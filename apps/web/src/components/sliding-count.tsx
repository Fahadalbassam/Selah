"use client";

import { SlidingNumber } from "@animate-ui/react/primitives/texts/sliding-number";
import type { ComponentProps } from "react";

/**
 * A number that rolls digit by digit (Animate UI Sliding Number). Each digit
 * is its own box in a flex row, and a flex row follows the page's direction:
 * on an Arabic page 17 would read 71 (page audit N12). Numbers are written
 * left to right in both languages, so the row always is.
 */
export function SlidingCount(props: Omit<ComponentProps<typeof SlidingNumber>, "dir">) {
  return <SlidingNumber {...props} dir="ltr" />;
}

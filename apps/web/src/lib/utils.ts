import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The `dir` of a text box people type into in either language. Empty, it
 * follows the page, so on an Arabic page the caret and the placeholder start
 * on the right; with text, the box takes the direction of what was typed. A
 * box with dir="auto" from the start is left to right while empty.
 */
export function typedDir(value: string): "auto" | undefined {
  return value.trim() ? "auto" : undefined;
}

/** Up to two initials for an avatar, in whatever script the name uses. */
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
}

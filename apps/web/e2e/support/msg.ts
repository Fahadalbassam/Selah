import { readFileSync } from "node:fs";

// The interface's own strings, so a test reads the same labels a person does in either language.
const cache: Record<string, unknown> = {};
export function msg(locale: "ar" | "en", key: string, vars: Record<string, string | number> = {}): string {
  cache[locale] ??= JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  let v: unknown = cache[locale];
  for (const k of key.split(".")) v = (v as Record<string, unknown>)?.[k];
  if (typeof v !== "string") throw new Error(`no message ${locale}:${key}`);
  return v.replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? `{${n}}`));
}
export const L = (locale: "ar" | "en") => (key: string, vars?: Record<string, string | number>) => msg(locale, key, vars);

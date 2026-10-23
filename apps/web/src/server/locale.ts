import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/config";

/** The reader's language for a file made on the server: the one they asked for, else the one they use the app in. */
export async function exportLocale(asked?: string): Promise<Locale> {
  if (isLocale(asked)) return asked;
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

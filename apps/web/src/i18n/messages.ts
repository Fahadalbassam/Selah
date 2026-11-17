import type { Locale } from "./config";

/**
 * The messages of one language, whatever language the page is in: for text
 * that belongs to a record's own language (a meeting's stored agenda).
 */
export async function messagesFor(locale: Locale) {
  return (await import(`../../messages/${locale}.json`)).default;
}

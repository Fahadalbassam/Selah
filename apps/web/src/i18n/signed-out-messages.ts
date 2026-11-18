// What the pages a signed-out person can open send to the browser. Client
// components get their strings from the page's HTML, so a layout that hands
// over the whole catalogue puts the firm's internal wording (triage, conflict
// checks, staffing) in the source of the sign-in page. Each signed-out layout
// hands over only the namespaces its own client components read, as the
// upload page does (ui-guidelines: no internal wording on public pages).
// tests/signed-out-messages.test.ts fails when a layout sends more.

export const SIGNED_OUT_NAMESPACES = {
  /** (auth): sign-in, forgot and reset password, invite, confirm e-mail, consent, two-factor setup. */
  auth: ["signIn", "account", "security", "consent", "common"],
  /** (public)/inquiry: the form and its side panel. */
  inquiry: ["inquiry"],
  /** (public)/legal, the inquiry privacy notice included: server-rendered; its client components read no strings. */
  legal: [],
  /** (public)/upload: the file form of a no-login upload link. */
  upload: ["uploadLink", "fileActions", "common"],
} as const satisfies Record<string, readonly string[]>;

export type SignedOutArea = keyof typeof SIGNED_OUT_NAMESPACES;

/** Only the named top-level namespaces of the catalogue. */
export function pickNamespaces(messages: Record<string, unknown>, namespaces: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(namespaces.filter((ns) => ns in messages).map((ns) => [ns, messages[ns]]));
}

/** The messages a signed-out layout passes to NextIntlClientProvider. */
export function signedOutMessages(messages: Record<string, unknown>, area: SignedOutArea): Record<string, unknown> {
  return pickNamespaces(messages, SIGNED_OUT_NAMESPACES[area]);
}

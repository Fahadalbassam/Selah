// Free mail providers. An account on one of these is shown with a
// "personal email" badge, so a client admin sees who is not on the company
// domain. Display only; access is decided by allowed_email_domains.
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "yandex.com",
  "mail.com",
]);

export function isPersonalEmail(email: string): boolean {
  return FREE_MAIL.has(email.split("@")[1]?.toLowerCase() ?? "");
}

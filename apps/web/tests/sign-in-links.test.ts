import { describe, expect, it } from "vitest";
import { renderMail } from "@/lib/mail-templates";
import { isSignInLinkToken, SIGN_IN_LINK_MINUTES, signInLinkVerifyPath } from "@/lib/sign-in-links";

// Sign-in links (wave 2, F14): the landing page accepts only tokens shaped
// like Better Auth's, its button goes to Better Auth's check, and the mail
// says how long the link works in both languages.
describe("sign-in links", () => {
  it("accepts only Better Auth's token shape", () => {
    expect(isSignInLinkToken("abcdefghijklmnopqrstuvwxyzABCDEF")).toBe(true);
    expect(isSignInLinkToken("abcdefghijklmnopqrstuvwxyzABCDE")).toBe(false);
    expect(isSignInLinkToken("abcdefghijklmnopqrstuvwxyzABCDE1")).toBe(false);
    expect(isSignInLinkToken("../../api/auth/sign-out")).toBe(false);
  });

  it("sends the button to the check, which comes back to sign-in on failure", () => {
    const url = new URL(signInLinkVerifyPath("abcdefghijklmnopqrstuvwxyzABCDEF"), "http://selah.test");
    expect(url.pathname).toBe("/api/auth/magic-link/verify");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: "abcdefghijklmnopqrstuvwxyzABCDEF",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    });
  });

  it("mails the landing page, never the check itself", () => {
    const m = renderMail("sign_in_link", "/sign-in/link/abcdefghijklmnopqrstuvwxyzABCDEF", "http://selah.test");
    expect(m.text).toContain("http://selah.test/sign-in/link/abcdefghijklmnopqrstuvwxyzABCDEF");
    expect(m.text).not.toContain("magic-link");
    expect(m.text).toContain(`${SIGN_IN_LINK_MINUTES} minutes`);
    expect(m.text).toContain(`${SIGN_IN_LINK_MINUTES} دقيقة`);
  });
});

// What the legal pages read from this server's own settings (R5): the way
// in, the mail relay and where the AI model runs; and how their texts are shown.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  edgeMode,
  legalDocFromSlug,
  LEGAL_DOCS,
  LEGAL_SLUGS,
  mailRelay,
  splitPageAddresses,
  SUBPROCESSOR_ROWS,
  subprocessorsInUse,
} from "@/lib/legal";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

describe("edge mode", () => {
  it("reads direct or tunnel from the compose profiles, direct winning", () => {
    expect(edgeMode(undefined)).toBeNull();
    expect(edgeMode("")).toBeNull();
    expect(edgeMode("tunnel")).toBe("tunnel");
    expect(edgeMode("gpu, direct")).toBe("direct");
    expect(edgeMode("tunnels")).toBeNull();
    expect(edgeMode("tunnel,direct")).toBe("direct");
  });
});

describe("legal slugs", () => {
  it("map every document both ways, the security overview included", () => {
    for (const d of LEGAL_DOCS) expect(legalDocFromSlug(LEGAL_SLUGS[d])).toBe(d);
    expect(legalDocFromSlug("security")).toBe("security");
    expect(legalDocFromSlug("nope")).toBeNull();
  });
});

describe("where mail goes", () => {
  it("is an outside service when the relay is a host on the internet", () => {
    expect(mailRelay("smtps://user:secret@smtp.resend.com:465", true)).toBe("outside");
    expect(mailRelay("smtp://mail.example.com:587", false)).toBe("outside");
    expect(mailRelay("smtps://user:secret@203.0.113.9:465", true)).toBe("outside");
    expect(mailRelay("smtp://[2001:db8::25]:25", true)).toBe("outside");
  });

  it("is local for a test mailbox on this machine or a relay on this server's own network", () => {
    // The review copy and the walkthrough: Mailpit on this machine.
    expect(mailRelay("smtp://localhost:1035", false)).toBe("local");
    expect(mailRelay("smtp://127.0.0.1:1025", false)).toBe("local");
    expect(mailRelay("smtp://[::1]:1025", false)).toBe("local");
    // The Docker test stack: another container, by its service name.
    expect(mailRelay("smtp://mailpit:1025", true)).toBe("local");
    expect(mailRelay("smtp://relay.internal:25", true)).toBe("local");
    expect(mailRelay("smtp://10.0.4.12:25", true)).toBe("local");
    expect(mailRelay("smtp://192.168.1.20:25", true)).toBe("local");
    expect(mailRelay("smtp://172.20.0.5:25", true)).toBe("local");
    expect(mailRelay("smtp://172.32.0.5:25", true)).toBe("outside");
  });

  it("is none in development with no relay, where mails are printed instead of sent", () => {
    expect(mailRelay(undefined, false)).toBe("none");
    expect(mailRelay("", false)).toBe("none");
    expect(mailRelay("   ", false)).toBe("none");
  });

  it("when it cannot tell, says outside rather than deny a service that may be in use", () => {
    // Production never sends without a relay, so "not told" is not "no mail".
    expect(mailRelay(undefined, true)).toBe("outside");
    expect(mailRelay("not a url", false)).toBe("outside");
  });
});

describe("the sub-processor list", () => {
  const base = { LLM_PROVIDER: "ollama", NODE_ENV: "production" };

  it("marks the mail row in use only when mail really leaves through an outside service", () => {
    expect(subprocessorsInUse({ ...base, SMTP_URL: "smtps://u:p@smtp.resend.com:465" }).mail).toBe(true);
    expect(subprocessorsInUse({ ...base, SMTP_URL: "smtp://mailpit:1025" }).mail).toBe(false);
    expect(subprocessorsInUse({ ...base, NODE_ENV: "development", SMTP_URL: "smtp://localhost:1035" }).mail).toBe(false);
    expect(subprocessorsInUse({ ...base, NODE_ENV: "development" }).mail).toBe(false);
    expect(subprocessorsInUse({ ...base }).mail).toBe(true);
  });

  it("reads every row from its own setting", () => {
    expect(SUBPROCESSOR_ROWS).toEqual(["edge", "mail", "llm"]);
    expect(subprocessorsInUse({ LLM_PROVIDER: "ollama", NODE_ENV: "development", SMTP_URL: "smtp://localhost:1035" })).toEqual({
      edge: false,
      mail: false,
      llm: false,
    });
    expect(
      subprocessorsInUse({ LLM_PROVIDER: "openai_compat", NODE_ENV: "production", SELAH_EDGE: "tunnel", SMTP_URL: "smtps://u:p@mail.example.com:465" }),
    ).toEqual({ edge: true, mail: true, llm: true });
    expect(subprocessorsInUse({ ...base, SELAH_EDGE: "direct", SMTP_URL: "smtp://mailpit:1025" })).toEqual({ edge: false, mail: false, llm: false });
  });

  it("has no row whose badge is fixed in the page", () => {
    const page = readFileSync("src/app/(public)/legal/[doc]/page.tsx", "utf8");
    expect(page).toContain("subprocessorsInUse(e)");
    expect(page).toContain("inUse[r]");
  });
});

describe("page addresses inside the legal texts", () => {
  it("are picked out as links, with the sentence around them untouched", () => {
    expect(splitPageAddresses("Listed at /legal/sub-processors. See /privacy.")).toEqual([
      { text: "Listed at " },
      { text: "/legal/sub-processors", href: "/legal/sub-processors" },
      { text: ". See " },
      { text: "/privacy", href: "/privacy" },
      { text: "." },
    ]);
    expect(splitPageAddresses("مذكورة في /legal/sub-processors.")).toEqual([
      { text: "مذكورة في " },
      { text: "/legal/sub-processors", href: "/legal/sub-processors" },
      { text: "." },
    ]);
  });

  it("leaves alone anything that is not a page of this site", () => {
    expect(splitPageAddresses("No address here.")).toEqual([{ text: "No address here." }]);
    expect(splitPageAddresses("See /legal/nothing and /privacy-policy.")).toEqual([{ text: "See /legal/nothing and /privacy-policy." }]);
  });

  it("never changes a text: the pieces join back to exactly what was written", () => {
    const strings: string[] = [];
    const walk = (o: unknown) => {
      if (typeof o === "string") strings.push(o);
      else if (o && typeof o === "object") Object.values(o).forEach(walk);
    };
    walk(ar.legal);
    walk(en.legal);
    for (const s of strings) expect(splitPageAddresses(s).map((p) => p.text).join("")).toBe(s);
    // Every address the texts name today becomes a link.
    const linked = strings.flatMap((s) => splitPageAddresses(s).filter((p) => p.href).map((p) => p.href));
    expect(new Set(linked)).toEqual(new Set(["/privacy", "/legal/sub-processors"]));
    expect(linked.length).toBe(8);
  });
});

describe("the consent page's summaries", () => {
  it("do not promise more than the notices do: no claim that data never leaves the Kingdom", () => {
    expect(ar.consent.docs.privacy.summary).not.toContain("يبقى في المملكة");
    expect(en.consent.docs.privacy.summary).not.toMatch(/stays in/i);
  });
});

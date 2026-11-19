// The number scanner (section 7 item 6): what it finds, what it leaves alone,
// and how its tags work with masking. Synthetic numbers only: the IDs and
// cards below are made up to pass (or fail) their check digit.
import { describe, expect, it, vi } from "vitest";
import { createMasker } from "@/lib/masking";
import { countNumbers, createNumberTagger, findNumbers, hasRawNumbers, totalNumbers } from "@/lib/sensitive-numbers";

const kinds = (text: string) => findNumbers(text).map((f) => `${f.kind}:${f.value}`);
const tag = (text: string) => createNumberTagger().tag(text);

// Valid check digits (Luhn), and the same numbers with the last digit changed.
const ID = "1012345672";
const ID_BAD = "1012345678";
const IQAMA = "2123456788";
const IQAMA_BAD = "2123456781";
// The ISO 13616 example IBAN for Saudi Arabia, and one with a wrong check.
const IBAN = "SA0380000000608010167519";
const IBAN_BAD = "SA0380000000608010167518";
const CARD = "4111111111111111";
const CARD_BAD = "4111111111111112";
const toArabic = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x660 + Number(d)));
const toPersian = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x6f0 + Number(d)));

describe("national ID and Iqama", () => {
  it("finds 10 digits starting 1 or 2 with a valid check digit", () => {
    expect(kinds(`ID ${ID}, iqama ${IQAMA}`)).toEqual([`ID:${ID}`, `IQAMA:${IQAMA}`]);
  });
  it("leaves a wrong check digit alone", () => {
    expect(kinds(`ID ${ID_BAD}, iqama ${IQAMA_BAD}`)).toEqual([]);
  });
  it("reads Arabic-Indic and Persian digits", () => {
    expect(kinds(`رقم الهوية ${toArabic(ID)} والإقامة ${toPersian(IQAMA)}`)).toEqual([`ID:${ID}`, `IQAMA:${IQAMA}`]);
    expect(tag(`رقم الهوية ${toArabic(ID)}`)).toBe("رقم الهوية [ID_1]");
  });
  it("splits two numbers written side by side", () => {
    expect(tag(`${ID} ${IQAMA}`)).toBe("[ID_1] [IQAMA_1]");
  });
  it("is not part of a decimal or a code", () => {
    expect(kinds(`${ID}.50 REF-${ID} X${ID} ${ID}9`)).toEqual([]);
  });
});

describe("IBAN", () => {
  it("finds a valid IBAN, compact or in groups", () => {
    expect(tag(`IBAN ${IBAN}`)).toBe("IBAN [IBAN_1]");
    expect(tag("IBAN SA03 8000 0000 6080 1016 7519, then 2026")).toBe("IBAN [IBAN_1], then 2026");
    expect(tag(`${IBAN} 2026`)).toBe("[IBAN_1] 2026");
  });
  it("leaves a wrong mod-97 check alone", () => {
    expect(kinds(`IBAN ${IBAN_BAD}`)).toEqual([]);
    expect(kinds("SA03 8000 0000 6080 1016 7518")).toEqual([]);
  });
  it("reads Arabic-Indic digits in an IBAN", () => {
    expect(kinds(`الآيبان SA${toArabic(IBAN.slice(2))}`)).toEqual([`IBAN:${IBAN}`]);
  });
});

describe("cards", () => {
  it("finds 13 to 19 digits that pass Luhn", () => {
    expect(tag("Card 4111 1111 1111 1111, Amex 378282246310005, 5500-0000-0000-0004")).toBe("Card [CARD_1], Amex [CARD_2], [CARD_3]");
  });
  it("leaves a failed Luhn check, and long numbers that are not cards, alone", () => {
    expect(kinds(`Card ${CARD_BAD}, ref 8111111111111111110`)).toEqual([]);
  });
  it("the same card written two ways has one tag", () => {
    expect(tag(`${CARD} and 4111 1111 1111 1111`)).toBe("[CARD_1] and [CARD_1]");
  });
});

describe("phones and e-mails", () => {
  it("finds Saudi mobile and landline forms", () => {
    const text = "0551234567, 055-123-4567, 055 123 4567, +966 55 123 4567, 00966551234567, 966551234567, (011) 234 5678, 0112345678, 920012345, 8001234567";
    expect(findNumbers(text).map((f) => f.kind)).toEqual(Array(10).fill("PHONE"));
    expect(tag("جوال ٠٥٥١٢٣٤٥٦٧")).toBe("جوال [PHONE_1]");
  });
  it("finds international numbers only with + or 00", () => {
    expect(kinds("+44 20 7946 0958")).toEqual(["PHONE:442079460958"]);
    expect(kinds("0044 20 7946 0958")).toEqual(["PHONE:00442079460958"]);
    expect(kinds("44 20 7946 0958")).toEqual([]);
  });
  it("finds e-mail addresses", () => {
    expect(tag("write to Reem.Harbi@example.sa or ريم@مثال.السعودية")).toBe("write to [EMAIL_1] or [EMAIL_2]");
  });
});

describe("passport and CR numbers, only next to their word", () => {
  it("finds a passport number after the word", () => {
    expect(tag("Passport No. A12345678 and passport number: 123456789")).toBe("Passport No. [PASSPORT_1] and passport number: [PASSPORT_2]");
    expect(tag("رقم جواز السفر A12345678، وجوازه رقم ١٢٣٤٥٦٧٨٩")).toBe("رقم جواز السفر [PASSPORT_1]، وجوازه رقم ١٢٣٤٥٦٧٨٩");
    expect(tag("جواز السفر رقم ١٢٣٤٥٦٧٨٩")).toBe("جواز السفر رقم [PASSPORT_1]");
  });
  it("leaves a 9-digit number that is not next to the word alone", () => {
    expect(kinds("Reference 345678912 for the passport office")).toEqual([]);
    expect(kinds("رقم المعاملة 345678912")).toEqual([]);
  });
  it("finds a CR number after the word, before reading it as an ID", () => {
    expect(tag(`سجل تجاري رقم 1010123456 و CR ${ID}`)).toBe("سجل تجاري رقم [CR_1] و CR [CR_2]");
    expect(tag("Commercial Registration No. 4030123456")).toBe("Commercial Registration No. [CR_1]");
    expect(kinds("1010123456")).toEqual([]);
  });
});

describe("false positives: what is not a personal number", () => {
  it.each([
    ["dates", "Approved on 2026-11-19, 19/11/2026, 19-11-2026, 2026/11/19 and ١٩/١١/٢٠٢٦"],
    ["amounts", "SAR 1,000,000 and 750,000 ريال، 1.000.000، 12,345,678,901 and 1,012,345,672"],
    ["years and counts", "Vision 2030, in 2026, 1447 هـ, 40 days, 3 members"],
    ["invoice and reference numbers", "INV-2026-00123, invoice 45821, PO#2026-118, ticket 778812, ISO 37001, v1.2.3"],
    ["article and policy codes", "Article 12.3, GOV-POL-007, المادة ٢٣"],
    ["a 9-digit number not next to a passport word", "Batch 345678912"],
  ])("%s", (_name, text) => {
    expect(findNumbers(text)).toEqual([]);
    expect(tag(text)).toBe(text);
  });
});

describe("the tagger", () => {
  it("counts different numbers by kind", () => {
    const pages = [`ID ${ID} and ${toArabic(ID)}`, `IBAN ${IBAN}, iqama ${IQAMA}, mail a@b.co`];
    expect(countNumbers(pages)).toEqual({ ID: 1, IQAMA: 1, IBAN: 1, EMAIL: 1 });
    expect(totalNumbers(countNumbers(pages))).toBe(4);
    expect(countNumbers("nothing here 2026")).toEqual({});
  });
  it("numbers tags already in a text apart by the file they came from", () => {
    const t = createNumberTagger();
    expect(t.tag(`live ${IQAMA}`)).toBe("live [IQAMA_1]");
    expect(t.tag("file A [IQAMA_1]", "A")).toBe("file A [IQAMA_2]");
    expect(t.tag("file B [IQAMA_1] [IQAMA_1]", "B")).toBe("file B [IQAMA_3] [IQAMA_3]");
    expect(t.tag("file A again [IQAMA_1]", "A")).toBe("file A again [IQAMA_2]");
    // Tags from a file are not numbers it saw: not counted, not restored.
    expect(t.found).toBe(1);
    expect(t.restore("[IQAMA_1] [IQAMA_2]")).toBe(`${IQAMA} [IQAMA_2]`);
  });
  it("leaves no raw number behind", () => {
    const text = `ID ${ID}, IBAN ${IBAN}, card ${CARD}, +966 55 123 4567, a.b@example.com, passport A12345678`;
    expect(hasRawNumbers(text)).toBe(true);
    expect(hasRawNumbers(tag(text))).toBe(false);
  });
});

describe("with masking", () => {
  it("tags numbers whether masking is on or off, and unmask keeps the tags", () => {
    for (const terms of [[], [{ kind: "ORG", term: "Acme Holding" }]]) {
      const numbers = createNumberTagger();
      const m = createMasker(terms, { numbers });
      const sent = m.mask(`Acme Holding: ID ${ID}, phone 0551234567, mail x@acme.sa`);
      expect(sent).not.toContain(ID);
      expect(sent).toContain("[ID_1]");
      expect(sent).toContain("[PHONE_1]");
      expect(sent).toContain("[EMAIL_1]");
      expect(m.unmask(sent)).toContain("[ID_1]");
      expect(m.unmask(sent)).not.toContain(ID);
      expect(m.numbers).toBe(numbers);
    }
  });
  it("masking's own long-digit rule never reuses the scanner's tag names", () => {
    const numbers = createNumberTagger();
    const m = createMasker([{ kind: "ORG", term: "Acme Holding" }], { numbers });
    // A real phone (tagged) and a 10-digit reference that is no personal number (masked, then given back).
    const sent = m.mask(`Acme Holding 0551234567 ref ${ID_BAD}`);
    expect(sent).toBe("[ORG_1] [PHONE_1] ref [NUMBER_1]");
    expect(m.unmask("[ORG_1] [PHONE_1] [NUMBER_1]")).toBe(`Acme Holding [PHONE_1] ${ID_BAD}`);
  });
  it("without a tagger, masking is as before", () => {
    const m = createMasker([{ kind: "ORG", term: "Acme Holding" }]);
    expect(m.mask("Acme Holding 0551234567")).toBe("[ORG_1] [PHONE_1]");
    expect(m.unmask("[PHONE_1]")).toBe("0551234567");
  });
});

describe("the last check before the AI service", () => {
  it("tags a number that reached a call untagged, in any field, and says so", async () => {
    const { sealed } = await import("@/services/ai-client");
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m) => void errors.push(m));
    try {
      const body = { question: `ID ${ID}`, passages: [{ id: "P1", text: `IBAN ${IBAN}`, source: "x" }], n: 3 };
      const out = sealed(body);
      expect(JSON.stringify(out)).not.toContain(ID);
      expect(JSON.stringify(out)).not.toContain(IBAN);
      // Its own range of tags, apart from a request's.
      expect(out).toEqual({ question: "ID [ID_S1]", passages: [{ id: "P1", text: "IBAN [IBAN_S1]", source: "x" }], n: 3 });
      expect(errors).toHaveLength(1);
      // Already tagged: unchanged, and nothing to say.
      expect(sealed(out)).toEqual(out);
      expect(errors).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
  it("never renumbers a request's tags, so a translation's restore() cannot put another person's number back (review S7)", async () => {
    const { sealed } = await import("@/services/ai-client");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A request tagged one ID; a second, different ID slipped through untagged.
      const request = createNumberTagger();
      const masked = request.tag(`first ${ID}`);
      const out = sealed({ text: `${masked}, second ${IQAMA}, also ${toArabic("1098765439")}` });
      expect(out.text).toBe("first [ID_1], second [IQAMA_S1], also [ID_S1]");
      // The reply comes back with both: only the request's own tag is given back.
      expect(request.restore(out.text)).toBe(`first ${ID}, second [IQAMA_S1], also [ID_S1]`);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("review of #213", () => {
  // The best of five runs: the first may include compiling the code, and the full suite runs files
  // side by side. A slow pattern (the review measured 2.8 s for 28 spaces after «جواز») is slow every time.
  const ms = (fn: () => unknown) => {
    const once = () => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    };
    return Math.min(once(), once(), once(), once(), once());
  };
  it("is linear: long spaces after every word, and long unbroken text, finish fast (B1, S9)", () => {
    const words = ["passport", "جواز", "جواز السفر رقم", "CR", "سجل تجاري", "commercial registration", "رقم الهوية", "ID", "Invoice", "IBAN SA", "@"];
    for (const w of words) {
      for (const space of [" ", " ", "​", "\n"]) {
        const text = `${w}${space.repeat(10_000)}x`;
        expect(ms(() => findNumbers(text)), `${w} + ${JSON.stringify(space)}`).toBeLessThan(50);
      }
    }
    // A 100,000-character run: of letters, of digits, of one e-mail-like word.
    for (const text of ["a".repeat(100_000), "1".repeat(100_000), "x.".repeat(50_000), "a@".repeat(50_000)]) {
      expect(ms(() => findNumbers(text)), text.slice(0, 6)).toBeLessThan(50);
    }
    // 100,000 characters made of the scan's worst cases (a group, a separator, again; an IBAN start
    // again and again): about 15 to 30 ms alone, twice that with the suite running beside it. A
    // quadratic or exponential step would take seconds here.
    for (const text of ["1 ".repeat(50_000), "SA03 ".repeat(20_000), "١-".repeat(50_000), "+(".repeat(50_000), "05 ".repeat(33_000)]) {
      expect(ms(() => findNumbers(text)), text.slice(0, 6)).toBeLessThan(100);
    }
    expect(ms(() => findNumbers("word ".repeat(8_000)))).toBeLessThan(50);
  });
  it("finds numbers written against Arabic letters, never against Latin ones (S2)", () => {
    expect(kinds(`رقم الهوية${ID}`)).toEqual([`ID:${ID}`]);
    expect(kinds("جوال٠٥٠١٢٣٤٥٦٧")).toEqual(["PHONE:0501234567"]);
    expect(kinds(`${ID}هوية`)).toEqual([`ID:${ID}`]);
    expect(kinds(`X${ID} ${ID}Y`)).toEqual([]);
  });
  it("reads more phone forms (S3)", () => {
    for (const p of ["501234567", "50 123 4567", "(+966) 50 123 4567", "wa.me/966501234567", "050.123.4567", "050/1234567", "tel:+966501234567"]) {
      expect(findNumbers(`call ${p} today`).map((f) => f.kind), p).toEqual(["PHONE"]);
    }
  });
  it("reads an IBAN in lower case, and an IBAN or a card split by dots or a line break (S4)", () => {
    expect(kinds(IBAN.toLowerCase())).toEqual([`IBAN:${IBAN}`]);
    expect(kinds("SA03.8000.0000.6080.1016.7519")).toEqual([`IBAN:${IBAN}`]);
    expect(kinds("SA03 8000 0000\n6080 1016 7519")).toEqual([`IBAN:${IBAN}`]);
    expect(kinds("4111.1111.1111.1111")).toEqual([`CARD:${CARD}`]);
    expect(kinds("4111 1111\n1111 1111")).toEqual([`CARD:${CARD}`]);
    // Ordinary words after two letters and two digits are never read into one.
    expect(kinds("to 2026 the board met in sa 03 and agreed")).toEqual([]);
  });
  it("drops invisible characters and marks, also inside an ID, keeping positions (S5)", () => {
    const hidden = `1012​345‍672`;
    expect(kinds(`ID ${hidden}`)).toEqual([`ID:${ID}`]);
    expect(tag(`ID ${hidden}!`)).toBe("ID [ID_1]!");
    for (const mark of ["‌", "⁠", "﻿", "­", "ـ", "‏", "‎", " ", " "]) {
      expect(kinds(`call 055${mark}123${mark}4567`), JSON.stringify(mark)).toEqual(["PHONE:0551234567"]);
    }
    expect(kinds(`الهوية ١٠١٢٣٤٥٦٧٢ٌ`)).toEqual([`ID:${ID}`]);
  });
  it("strips combining marks in mask() before the number scan (S6)", () => {
    const m = createMasker([], { numbers: createNumberTagger() });
    expect(m.mask(`هوية 1ً012345672`)).toBe("هوية [ID_1]");
  });
  it("reads a grouped ID after its word, passport and CR numbers in a table, and keeps document numbers (notes)", () => {
    expect(kinds("رقم الهوية: 1012 345 672")).toEqual([`ID:${ID}`]);
    expect(kinds("National ID no. 101-234-5672")).toEqual([`ID:${ID}`]);
    expect(kinds("ref 1012 345 672")).toEqual([]);
    expect(kinds("| Passport | A12345678 |")).toEqual(["PASSPORT:A12345678"]);
    expect(kinds("| السجل التجاري | 1010123456 |")).toEqual(["CR:1010123456"]);
    for (const doc of ["PO 0512345678", "Ref: 0112345678", "Contract No. 0501234567", "Invoice #0551234567", "رقم العقد 0512345678", "رقم الطلب: 0112345678", `Contract No. ${IQAMA}`, `Ref ${ID}`, "Variance +12500000", "SAP doc 0090012345", "Amount 920012345"]) {
      expect(kinds(doc), doc).toEqual([]);
    }
  });
});

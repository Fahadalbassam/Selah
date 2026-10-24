import { parseXml } from "./xml";
import { OfficeFileError, readEntries } from "./zip";

export const PPTX_LIMITS = { slides: 500 };

type Node = Record<string, unknown>;
const list = (v: unknown): Node[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]) as Node[];
const attr = (n: Node | undefined, name: string) => (n ? (n[`@_${name}`] as string | undefined) : undefined);

/** Every text run in a slide, a paragraph per line, in the order the file holds them. */
function slideText(xml: string): string {
  const lines: string[] = [];
  const walk = (v: unknown) => {
    for (const n of list(v)) {
      if (typeof n !== "object") continue;
      for (const [k, child] of Object.entries(n)) {
        if (k.startsWith("@_")) continue;
        if (k === "p") {
          for (const p of list(child)) {
            const text = list(p.r)
              .concat(list(p.fld))
              .map((r) => (typeof r.t === "string" ? r.t : typeof (r.t as Node | undefined)?.["#text"] === "string" ? (r.t as Node)["#text"] : ""))
              .join("")
              .trim();
            if (text) lines.push(text);
          }
        } else walk(child);
      }
    }
  };
  walk(parseXml(xml, { arrays: ["p", "r", "fld", "sp", "grpSp", "graphicFrame", "tr", "tc"] }));
  return lines.join("\n\n");
}

/**
 * The text of a .pptx by slide, in the order the presentation shows them
 * (presentation.xml), for the assistant's index. Speaker notes are left out:
 * they are often not meant for the audience.
 */
export function readPptxSlides(bytes: Uint8Array): string[] {
  const files = readEntries(bytes, (p) => p === "ppt/presentation.xml" || p === "ppt/_rels/presentation.xml.rels" || /^ppt\/slides\/slide\d+\.xml$/.test(p));
  const presentation = files.get("ppt/presentation.xml");
  if (!presentation) throw new OfficeFileError("not_office");
  const rels = new Map<string, string>();
  const relsXml = files.get("ppt/_rels/presentation.xml.rels");
  if (relsXml) {
    const root = (parseXml(relsXml, { arrays: ["Relationship"] }) as Node).Relationships as Node | undefined;
    for (const r of list(root?.Relationship)) rels.set(attr(r, "Id") ?? "", `ppt/${(attr(r, "Target") ?? "").replace(/^\/?ppt\//, "").replace(/^\.\//, "")}`);
  }
  // Read with a pattern: dropping namespace prefixes would merge a slide's
  // "id" and "r:id" attributes, and the order is all that is needed here.
  if (/<!DOCTYPE/i.test(presentation)) throw new OfficeFileError("unsafe");
  const order = [...presentation.matchAll(/<(?:\w+:)?sldId\b[^>]*?\br:id="([^"]+)"/g)].map((m) => rels.get(m[1]!) ?? "");
  const paths = order.length ? order : [...files.keys()].filter((p) => p.startsWith("ppt/slides/")).sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
  return paths.slice(0, PPTX_LIMITS.slides).map((p) => {
    const xml = files.get(p);
    return xml ? slideText(xml) : "";
  });
}

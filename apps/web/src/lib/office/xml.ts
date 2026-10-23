import { XMLParser } from "fast-xml-parser";
import { OfficeFileError } from "./zip";

/**
 * XML from inside an Office file. Namespace prefixes are dropped (w:p is p),
 * attributes keep an "@_" prefix, and values stay strings. A document type
 * declaration is refused outright: Office never writes one, and it is how
 * entity-expansion and external-entity attacks start.
 */
export function parseXml(xml: string, options: { ordered?: boolean; arrays?: string[] } = {}): unknown {
  if (/<!DOCTYPE/i.test(xml)) throw new OfficeFileError("unsafe");
  const arrays = new Set(options.arrays ?? []);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    preserveOrder: options.ordered ?? false,
    processEntities: true,
    // Character references (&#1575;): openpyxl and others write Arabic this way.
    htmlEntities: true,
    isArray: options.ordered ? undefined : (name) => arrays.has(name),
  });
  try {
    return parser.parse(xml);
  } catch {
    throw new OfficeFileError("not_office");
  }
}

/** Escape text for an XML element or attribute we write. Drops characters XML 1.0 cannot carry. */
export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

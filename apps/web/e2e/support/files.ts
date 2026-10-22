// Small test files built in memory.
export function pdf(text = "Selah e2e evidence"): Buffer {
  const body = `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R>>endobj 4 0 obj<</Length ${text.length + 30}>>stream\nBT /F1 18 Tf 20 60 Td (${text}) Tj ET\nendstream endobj`;
  return Buffer.from(`%PDF-1.4\n${body}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
}
// The standard antivirus test string (harmless; every scanner flags it).
export const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

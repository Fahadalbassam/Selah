import { execFileSync } from "node:child_process";

// Read-only lookups for test ids, straight from the database container.
export function sql<T = Record<string, string>>(query: string): T[] {
  const out = execFileSync("docker", ["exec", "-i", "selah-db-1", "psql", "-U", "postgres", "-d", "selah", "-tA", "-F", "\t", "-c", query], { encoding: "utf8" });
  const lines = out.trim().split("\n").filter(Boolean);
  return lines.map((l) => l.split("\t")) as unknown as T[];
}
export const one = (query: string): string => {
  const r = sql<string[]>(query)[0];
  if (!r) throw new Error(`no row: ${query}`);
  return r[0]!;
};
export const ids = {
  board: () => one(`select id from projects where title='حوكمة مجلس الإدارة'`),
  rawdah: () => one(`select id from projects where title='الخطة الاستراتيجية ٢٠٢٧'`),
  waha: () => one(`select id from projects where title='حوكمة الشركة العائلية'`),
  internal: () => one(`select id from projects where kind='internal' limit 1`),
  action: (title: string) => one(`select id from actions where title='${title}'`),
  rec: (title: string) => one(`select id from recommendations where title='${title}'`),
  user: (email: string) => one(`select id from "user" where email='${email}'`),
  org: (name: string) => one(`select id from organizations where name='${name}'`),
  doc: (title: string) => one(`select id from documents where title='${title}' order by created_at desc limit 1`),
};

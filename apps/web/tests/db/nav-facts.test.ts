// A consultant's sidebar rows "shown only when they apply" (page audit 4.1,
// batch 2) against a real Postgres: Team for one who leads or deputises for a
// client, Inquiries while one is assigned to them, Assessment templates for a
// named author. The facts are read as the consultant, under row-level
// security, and only choose rows: the pages keep their own checks.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { sidebarFor } from "@/lib/nav";
import { consultantNavFacts } from "@/services/nav";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-c210-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const OTHER_FIRM = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead
  deputy: id(13), // Acme's deputy
  cons: id(14), // on Acme's team, nothing else
  author: id(15), // a named template author
  inquirer: id(16), // owns an inquiry
  elsewhere: id(17), // a consultant of another firm, an author there and owner of its inquiry
  cadmin: id(21), // Acme's client admin
};

const facts = async (userId: string) => {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return await consultantNavFacts(tx, (await loadPrincipal(tx, userId))!);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
};

const inquiry = (n: number, firm: string, ownerId: string | null, status = "triaged") =>
  owner.query(
    `INSERT INTO inquiries (id, firm_org_id, public_ref, org_name, contact_name, contact_role, contact_email, contact_phone, message,
       sector_id, employee_band, ownership_type, self_check, privacy_notice_version, consented_at, preferred_language, status, conflict_status, owner_user_id)
     VALUES ($1,$2,$3,'Prospect','Majed','CEO','majed@example.test','+966 55 111 1111','Wants a charter',
       (SELECT id FROM sectors LIMIT 1),'50-249','llc','{}','2026-10-20',now(),'ar',$4,'clear',$5)`,
    [id(100 + n), firm, `INQ-NAV0000${n}`, status, ownerId],
  );

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'firm','other firm')`, [FIRM, ACME, OTHER_FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  const roles: [string, string, string][] = [
    [U.admin, FIRM, "firm_admin"],
    [U.lead, FIRM, "consultant"],
    [U.deputy, FIRM, "consultant"],
    [U.cons, FIRM, "consultant"],
    [U.author, FIRM, "consultant"],
    [U.inquirer, FIRM, "consultant"],
    [U.elsewhere, OTHER_FIRM, "consultant"],
    [U.cadmin, ACME, "client_admin"],
  ];
  for (const [u, o, r] of roles) await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,$3)`, [u, o, r]);
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false)`,
    [ACME, U.lead, U.deputy, U.cons],
  );
  await q(`INSERT INTO template_authors (firm_org_id, user_id, granted_by) VALUES ($1,$2,$3), ($4,$5,$5)`, [FIRM, U.author, U.admin, OTHER_FIRM, U.elsewhere]);
  // A closed inquiry still counts: it stays assigned to its owner, and the row keeps it reachable.
  await inquiry(1, FIRM, U.inquirer, "lost");
  // Someone else's, and nobody's: neither shows the row to a consultant.
  await inquiry(2, FIRM, U.lead);
  await inquiry(3, FIRM, null);
  await inquiry(4, OTHER_FIRM, U.elsewhere);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("a consultant's rows that show only when they apply", () => {
  it("Team for the lead and for the deputy of a client; not for a consultant who is only on its team", async () => {
    expect(await facts(U.lead)).toMatchObject({ leadsClient: true });
    expect(await facts(U.deputy)).toMatchObject({ leadsClient: true });
    expect(await facts(U.cons)).toEqual({ leadsClient: false, templateAuthor: false, inquiryAssigned: false });
  });

  it("Assessment templates for a named author of their own firm only", async () => {
    expect(await facts(U.author)).toMatchObject({ templateAuthor: true, leadsClient: false });
    expect(await facts(U.lead)).toMatchObject({ templateAuthor: false });
  });

  it("Inquiries while one is assigned to them, closed or not; never for someone else's or an unassigned one", async () => {
    expect(await facts(U.inquirer)).toMatchObject({ inquiryAssigned: true });
    expect(await facts(U.lead)).toMatchObject({ inquiryAssigned: true });
    expect(await facts(U.deputy)).toMatchObject({ inquiryAssigned: false });
    expect(await facts(U.cons)).toMatchObject({ inquiryAssigned: false });
  });

  it("reads nothing for the firm admin (every row is theirs) or for client people", async () => {
    expect(await facts(U.admin)).toEqual({});
    expect(await facts(U.cadmin)).toEqual({});
  });

  it("turns into the rows the sidebar draws", async () => {
    const rows = async (u: string) => sidebarFor("consultant", await facts(u)).flatMap((s) => s.rows.map((r) => r.key));
    expect(await rows(U.cons)).toEqual(["home", "projects", "clients", "actions", "assistant"]);
    expect(await rows(U.deputy)).toEqual(["home", "projects", "clients", "actions", "assistant", "team"]);
    expect(await rows(U.author)).toEqual(["home", "projects", "clients", "actions", "assistant", "templates"]);
    expect(await rows(U.inquirer)).toEqual(["home", "projects", "clients", "actions", "inquiries", "assistant"]);
  });
});

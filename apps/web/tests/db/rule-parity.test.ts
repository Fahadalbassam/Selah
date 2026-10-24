// Rules held twice, once in the database (the authority) and once in
// TypeScript (so a form or route can answer before a write), proved to be the
// same rule. Each test reads the database's version, by trying writes or from
// the catalog, and compares it with the TypeScript constant the app uses.
// docs/rules.md lists every rule and which of these covers it.
//
// Run: TEST_DATABASE_OWNER_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPEN_STATUSES, TRANSITIONS } from "@/authz/workflow";
import { actionStatus, evidenceRequestStatus } from "@/db/schema";
import { FIRM_TIME_ZONE, firmToday } from "@/lib/dates";
import { SHORT_NAMES } from "@/lib/engagement";
import { CHECKIN_DAYS, FIRM_SETTING_RANGES } from "@/lib/firm-settings";
import {
  LADDER_AUDIENCES,
  MAIL_CADENCES,
  MAIL_DEFAULTS,
  RAMADAN_DEFAULTS,
  RAMADAN_SPAN_DAYS,
  REMINDER_CADENCES,
  UPDATE_MAIL_KINDS,
  WEEKLY_DAY,
  WORK_MAIL_KINDS,
} from "@/lib/mail-choices";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { MAIL_KINDS } from "@/lib/mail-templates";
import { NAME_ALT_LENGTH } from "@/lib/masking";
import { callProvider, SPOKEN_LANGS } from "@/lib/meetings";
import { PHASE_LIMITS } from "@/lib/phases";
import { TRANSCRIPT_FORMATS, TRANSCRIPT_MAX_CHARS } from "@/lib/transcripts";
import { TRANSLATABLE, TRANSLATION_MAX_CHARS } from "@/lib/translations";
import { HAND_OVER_KINDS } from "@/services/accounts";
import { FIRM_SETTING_DEFAULTS } from "@/services/firm-settings";
import { EVIDENCE_REQUEST_MOVES } from "@/services/follow-through";
import { ACME, ACME_PROJ_1, FIRM } from "../fixtures";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
if (!ownerUrl) throw new Error("set TEST_DATABASE_OWNER_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-9300-${String(n).padStart(12, "0")}`;
const CONSULTANT = id(1);
const REC = id(101);
const ACTION = id(201);
const ITEM = id(301);

/** Run fn in a transaction that is always rolled back. */
async function rolledBack<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await owner.connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

/** The error message if the statement is refused, else null; nothing it does is kept. */
async function refusal(c: PoolClient, sql: string, params: unknown[] = []): Promise<string | null> {
  await c.query("SAVEPOINT try");
  try {
    await c.query(sql, params);
    return null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT try");
  }
}

async function constraintDef(table: string, name: string): Promise<string> {
  const r = await owner.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2`,
    [table, name],
  );
  expect(r.rows, `${table}.${name}`).toHaveLength(1);
  return r.rows[0].def as string;
}

const quoted = (s: string) => [...s.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
const numbers = (s: string) => [...s.matchAll(/\b\d+\b/g)].map((m) => Number(m[0]));
const sorted = <T>(xs: Iterable<T>) => [...xs].sort();

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1, 'firm', 'firm'), ($2, 'client', 'Acme')`, [FIRM, ACME]);
  await q(`INSERT INTO "user" (id, name, email) VALUES ($1, 'consultant', 'consultant@example.test')`, [CONSULTANT]);
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1, $2, 'consultant')`, [CONSULTANT, FIRM]);
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES ($1, 'client', $2, $3, 'Acme governance', 'active')`, [
    ACME_PROJ_1,
    ACME,
    FIRM,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id, is_lead) VALUES ($1, $2, true)`, [ACME_PROJ_1, CONSULTANT]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1, $2, $3, 'Board charter', $4)`, [
    REC,
    ACME_PROJ_1,
    ACME,
    CONSULTANT,
  ]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, owner_user_id, due_date, created_by)
     VALUES ($1, $2, $3, $4, 'Draft the charter', 'draft', $5, current_date + 30, $5)`,
    [ACTION, ACME_PROJ_1, ACME, REC, CONSULTANT],
  );
  await q(`INSERT INTO evidence_requests (id, project_id, org_id, action_id, title, created_by) VALUES ($1, $2, $3, $4, 'Signed charter', $5)`, [
    ITEM,
    ACME_PROJ_1,
    ACME,
    ACTION,
    CONSULTANT,
  ]);
});

afterAll(async () => {
  await owner.end();
});

describe("the firm's day and open actions", () => {
  it("app_firm_tz() and app_firm_today() are FIRM_TIME_ZONE and firmToday()", async () => {
    const { rows } = await owner.query(`SELECT app_firm_tz() AS tz, app_firm_today()::text AS today`);
    expect(rows[0].tz).toBe(FIRM_TIME_ZONE);
    expect(rows[0].today).toBe(firmToday());
  });

  it("app_action_open() is true for exactly the OPEN_STATUSES", async () => {
    const { rows } = await owner.query(`SELECT s::text AS s FROM unnest(enum_range(NULL::action_status)) s WHERE app_action_open(s)`);
    expect(rows.map((r) => r.s).sort()).toEqual([...OPEN_STATUSES].sort());
  });

  it("no function or view spells out the zone or the open states again", async () => {
    const { rows } = await owner.query(
      `SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname NOT IN ('app_firm_tz', 'app_action_open')
         AND (p.prosrc LIKE '%Asia/Riyadh%' OR p.prosrc LIKE '%NOT IN (''draft'', ''verified_complete'', ''closed'')%')
       UNION ALL
       SELECT viewname FROM pg_views WHERE schemaname = 'public'
         AND (definition LIKE '%Asia/Riyadh%' OR definition LIKE '%verified_complete%closed%draft%')`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });
});

describe("action workflow", () => {
  it("check_action_transition() allows exactly the moves in TRANSITIONS", async () => {
    const statuses = actionStatus.enumValues;
    const allowed: string[] = [];
    await rolledBack(async (c) => {
      for (const from of statuses) {
        // Put the action in `from` without the workflow trigger, then try each move with it.
        await c.query(`ALTER TABLE actions DISABLE TRIGGER action_transition`);
        await c.query(`UPDATE actions SET status = $2, closure_outcome = $3, closure_note = $4 WHERE id = $1`, [
          ACTION,
          from,
          from === "closed" ? "not_applicable" : null,
          from === "closed" ? "out of scope" : null,
        ]);
        await c.query(`ALTER TABLE actions ENABLE TRIGGER action_transition`);
        for (const to of statuses) {
          if (to === from) continue;
          const closing = to === "closed";
          const err = await refusal(c, `UPDATE actions SET status = $2, closure_outcome = $3, closure_note = $4 WHERE id = $1`, [
            ACTION,
            to,
            closing ? "not_applicable" : null,
            closing ? "out of scope" : null,
          ]);
          // Any other refusal (no accept review yet, say) is a later rule of an allowed move.
          if (!err?.startsWith("invalid action status change")) allowed.push(`${from}>${to}`);
        }
      }
    });
    expect(sorted(allowed)).toEqual(sorted(Object.keys(TRANSITIONS)));
  });

  it("TRANSITIONS names only statuses the database has", () => {
    const statuses = new Set<string>(actionStatus.enumValues);
    for (const move of Object.keys(TRANSITIONS)) for (const s of move.split(">")) expect(statuses.has(s), s).toBe(true);
  });
});

describe("evidence list items", () => {
  it("check_evidence_request() allows exactly the decisions in EVIDENCE_REQUEST_MOVES", async () => {
    const allowed: string[] = [];
    await rolledBack(async (c) => {
      // A decision is the firm's: as a signed-in consultant, not the system.
      await c.query(`SELECT set_config('selah.user_id', $1, true)`, [CONSULTANT]);
      for (const from of evidenceRequestStatus.enumValues) {
        await c.query(`ALTER TABLE evidence_requests DISABLE TRIGGER evidence_request_rules`);
        await c.query(`UPDATE evidence_requests SET status = $2, decision_note = 'set up' WHERE id = $1`, [ITEM, from]);
        await c.query(`ALTER TABLE evidence_requests ENABLE TRIGGER evidence_request_rules`);
        for (const to of Object.keys(EVIDENCE_REQUEST_MOVES)) {
          if (to === from) continue;
          const err = await refusal(c, `UPDATE evidence_requests SET status = $2, decision_note = 'why' WHERE id = $1`, [ITEM, to]);
          if (!err?.startsWith("invalid evidence request change")) allowed.push(`${from}>${to}`);
        }
      }
    });
    const expected = Object.entries(EVIDENCE_REQUEST_MOVES).flatMap(([to, froms]) => froms.map((from) => `${from}>${to}`));
    expect(sorted(allowed)).toEqual(sorted(expected));
  });
});

describe("firm settings", () => {
  const column = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

  it("each range in FIRM_SETTING_RANGES is the database's", async () => {
    await rolledBack(async (c) => {
      await c.query(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
      for (const [key, [min, max]] of Object.entries(FIRM_SETTING_RANGES)) {
        // The chat days also depend on each other: idle deletion comes after archiving.
        const others =
          key === "chatIdleDeleteDays" ? ", chat_archive_days = 7" : key === "chatArchiveDays" ? ", chat_idle_delete_days = 730" : "";
        const set = (v: number) => refusal(c, `UPDATE firm_settings SET ${column(key)} = $2${others} WHERE org_id = $1`, [FIRM, v]);
        expect(await set(min), `${key} = ${min}`).toBeNull();
        expect(await set(max), `${key} = ${max}`).toBeNull();
        expect(await set(min - 1), `${key} = ${min - 1}`).not.toBeNull();
        expect(await set(max + 1), `${key} = ${max + 1}`).not.toBeNull();
      }
    });
  });

  it("check-in days follow CHECKIN_DAYS", async () => {
    await rolledBack(async (c) => {
      await c.query(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
      const set = (days: number[]) => refusal(c, `UPDATE firm_settings SET checkin_days = $2 WHERE org_id = $1`, [FIRM, days]);
      const many = Array.from({ length: CHECKIN_DAYS.count }, (_, i) => i + 1);
      expect(await set([CHECKIN_DAYS.min])).toBeNull();
      expect(await set([CHECKIN_DAYS.max])).toBeNull();
      expect(await set(many)).toBeNull();
      expect(await set([CHECKIN_DAYS.min - 1])).not.toBeNull();
      expect(await set([CHECKIN_DAYS.max + 1])).not.toBeNull();
      expect(await set([...many, CHECKIN_DAYS.count + 1])).not.toBeNull();
    });
  });

  it("FIRM_SETTING_DEFAULTS are the column defaults and the functions' fallbacks", async () => {
    await rolledBack(async (c) => {
      const fallbacks = (await c.query(`SELECT app_checkin_days($1) AS checkins, app_restricted_max_admins() AS admins`, [FIRM])).rows[0];
      expect(fallbacks.checkins).toEqual(FIRM_SETTING_DEFAULTS.checkinDays);
      expect(fallbacks.admins).toBe(FIRM_SETTING_DEFAULTS.restrictedMaxAdmins);
      const row = (await c.query(`INSERT INTO firm_settings (org_id) VALUES ($1) RETURNING *`, [FIRM])).rows[0];
      // Times come back with seconds; the app works in HH:MM.
      const clock = (v: unknown) => (typeof v === "string" && /^\d\d:\d\d:\d\d$/.test(v) ? v.slice(0, 5) : v);
      for (const [key, value] of Object.entries(FIRM_SETTING_DEFAULTS)) expect(clock(row[column(key)]), key).toEqual(value);
    });
  });
});

describe("mail choices", () => {
  const clock = (v: string | null) => (v ? v.slice(0, 5) : v);

  it("MAIL_CADENCES is the mail_cadence enum, and REMINDER_CADENCES is what mail_reminders_cadence allows", async () => {
    const r = await owner.query(`SELECT enum_range(NULL::mail_cadence)::text[] AS v`);
    expect(r.rows[0].v).toEqual([...MAIL_CADENCES]);
    await rolledBack(async (c) => {
      for (const cadence of MAIL_CADENCES) {
        const refused = await refusal(c, `INSERT INTO mail_preferences (user_id, reminders) VALUES ($1, $2)`, [CONSULTANT, cadence]);
        expect(refused === null, cadence).toBe((REMINDER_CADENCES as readonly string[]).includes(cadence));
      }
    });
  });

  it("MAIL_DEFAULTS are the column defaults and app_mail_choice()'s fallback", async () => {
    await rolledBack(async (c) => {
      const none = (await c.query(`SELECT * FROM app_mail_choice($1)`, [id(999)])).rows[0];
      const row = (await c.query(`INSERT INTO mail_preferences (user_id) VALUES ($1) RETURNING *`, [CONSULTANT])).rows[0];
      for (const r of [none, row]) {
        expect({
          updates: r.updates,
          reminders: r.reminders,
          quietFrom: clock(r.quiet_from),
          quietTo: clock(r.quiet_to),
          saturday: r.saturday,
          ramadan: r.ramadan,
        }).toEqual(MAIL_DEFAULTS);
      }
    });
  });

  it("UPDATE_MAIL_KINDS and WORK_MAIL_KINDS are the database's lists, and are known mail kinds", async () => {
    const r = await owner.query(`SELECT app_update_mail_kinds() AS updates, app_work_mail_kinds() AS work`);
    expect(sorted(r.rows[0].updates)).toEqual(sorted(UPDATE_MAIL_KINDS));
    expect(sorted(r.rows[0].work)).toEqual(sorted(WORK_MAIL_KINDS));
    for (const k of WORK_MAIL_KINDS) expect(MAIL_KINDS).toContain(k);
  });

  it("WEEKLY_DAY is the day app_cadence_due() sends the weekly summary", async () => {
    const r = await owner.query(
      `SELECT extract(dow FROM d)::int AS dow FROM generate_series('2027-05-17'::date, '2027-05-23', '1 day') d WHERE app_cadence_due('weekly', d::date)`,
    );
    expect(r.rows).toEqual([{ dow: WEEKLY_DAY }]);
  });

  it("RAMADAN_DEFAULTS and RAMADAN_SPAN_DAYS are the firm_settings defaults and ramadan_dates", async () => {
    await rolledBack(async (c) => {
      const row = (await c.query(`INSERT INTO firm_settings (org_id) VALUES ($1) RETURNING *`, [FIRM])).rows[0];
      expect({ mailFrom: clock(row.ramadan_mail_from), mailTo: clock(row.ramadan_mail_to) }).toEqual(RAMADAN_DEFAULTS);
      const allowed: number[] = [];
      for (let span = 25; span <= 32; span++) {
        const refused = await refusal(c, `UPDATE firm_settings SET ramadan_starts = '2027-02-08', ramadan_ends = '2027-02-08'::date + $2::int WHERE org_id = $1`, [
          FIRM,
          span,
        ]);
        if (refused === null) allowed.push(span);
      }
      expect([allowed[0], allowed.at(-1)]).toEqual([...RAMADAN_SPAN_DAYS]);
    });
  });

  it("LADDER_AUDIENCES lists every audience app_action_ladder() can name", async () => {
    const def = (await owner.query(`SELECT pg_get_functiondef('app_action_ladder(uuid)'::regprocedure) AS d`)).rows[0].d as string;
    const named = [...def.matchAll(/THEN '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(sorted(new Set(named))).toEqual(sorted(LADDER_AUDIENCES));
  });
});

describe("terms and notices", () => {
  it("LEGAL_VERSIONS are app_legal_version() for every document the database knows", async () => {
    const { rows } = await owner.query(`SELECT d::text AS doc, app_legal_version(d) AS v FROM unnest(enum_range(NULL::legal_doc)) d`);
    expect(Object.fromEntries(rows.map((r) => [r.doc, r.v]))).toEqual(LEGAL_VERSIONS);
  });
});

describe("people leaving", () => {
  it("HAND_OVER_KINDS is what app_hand_over() accepts, and the blocking kinds of app_person_holdings_of()", async () => {
    const def = (await owner.query(`SELECT pg_get_functiondef('app_hand_over(uuid,uuid,text[])'::regprocedure) AS d`)).rows[0].d as string;
    const accepted = /kinds <@ ARRAY\[([^\]]+)\]/.exec(def)![1]!.match(/[a-z_]+/g)!;
    expect(accepted).toEqual([...HAND_OVER_KINDS]);
    const report = (await owner.query(`SELECT pg_get_functiondef('app_person_holdings_of(uuid)'::regprocedure) AS d`)).rows[0].d as string;
    const listed = [...report.matchAll(/SELECT '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(sorted(listed.filter((k) => k !== "department_head"))).toEqual(sorted(HAND_OVER_KINDS));
  });
});

describe("meetings and transcripts", () => {
  it("call links: callProvider() and check_meeting() agree", async () => {
    const urls = [
      "https://meet.google.com/abc-defg-hij",
      "https://MEET.GOOGLE.COM/abc-defg-hij",
      "https://teams.microsoft.com/l/meetup-join/x",
      "https://teams.live.com/meet/9",
      "https://zoom.us/j/123",
      "https://us02web.zoom.us/j/123?pwd=x",
      "http://meet.google.com/abc-defg-hij",
      "https://meet.google.com.evil.example/abc",
      "https://evil.example/meet.google.com",
      "https://zoom.us.evil.example/j/1",
      "https://a.b.zoom.us/j/1",
      "https://teams.microsoft.com@evil.example/x",
      "javascript:alert(1)",
    ];
    await rolledBack(async (c) => {
      for (const url of urls) {
        await c.query("SAVEPOINT m");
        let provider: string | null = null;
        try {
          const r = await c.query(
            `INSERT INTO meetings (project_id, org_id, kind, title, starts_at, ends_at, location, join_url, organizer_id, ics_uid)
             VALUES ($1, $2, 'status', 'Check-in', now() + interval '1 day', now() + interval '1 day 1 hour', 'online', $3, $4, 'x')
             RETURNING provider`,
            [ACME_PROJ_1, ACME, url, CONSULTANT],
          );
          provider = r.rows[0].provider;
        } catch (err) {
          expect((err as Error).message, url).toMatch(/Google Meet, Teams or Zoom/);
        }
        await c.query("ROLLBACK TO SAVEPOINT m");
        expect(provider, url).toBe(callProvider(url));
      }
    });
  });

  it("languages, formats and transcript length are the database's", async () => {
    expect(quoted(await constraintDef("meetings", "meeting_spoken_lang"))).toEqual(sorted(SPOKEN_LANGS));
    expect(quoted(await constraintDef("meeting_transcripts", "transcript_lang"))).toEqual(sorted(SPOKEN_LANGS));
    expect(quoted(await constraintDef("meeting_transcripts", "transcript_format"))).toEqual(sorted(TRANSCRIPT_FORMATS));
    expect(Math.max(...numbers(await constraintDef("meeting_transcripts", "transcript_size")))).toBe(TRANSCRIPT_MAX_CHARS);
  });
});

describe("mail", () => {
  it("MAIL_KINDS are the kinds outbound_emails accepts", async () => {
    expect(quoted(await constraintDef("outbound_emails", "outbound_kind"))).toEqual(sorted(MAIL_KINDS));
  });
});

describe("translations", () => {
  const pairs = Object.entries(TRANSLATABLE).flatMap(([type, fields]) => fields.map((f) => `${type}.${f}`));

  it("app_translation_source() reads exactly the TRANSLATABLE fields", async () => {
    const src = (await owner.query(`SELECT prosrc FROM pg_proc WHERE proname = 'app_translation_source'`)).rows[0].prosrc as string;
    expect(sorted([...src.matchAll(/WHEN '([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]))).toEqual(sorted(pairs));
    await rolledBack(async (c) => {
      expect(await refusal(c, `SELECT * FROM app_translation_source('action', $1, 'owner_name')`, [ACTION])).toMatch(/cannot be translated/);
    });
  });

  it("editing a TRANSLATABLE field drops its translations, and only those fields are watched", async () => {
    const r = await owner.query(
      `SELECT encode(t.tgargs, 'escape') AS args FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid WHERE p.proname = 'drop_translations' AND NOT t.tgisinternal`,
    );
    const watched = r.rows.flatMap((row: { args: string }) => {
      const [type, , ...fields] = row.args.split("\\000").filter(Boolean);
      return fields.map((f) => `${type}.${f}`);
    });
    expect(sorted(watched)).toEqual(sorted(pairs));
  });

  it("TRANSLATION_MAX_CHARS is the database's", async () => {
    expect(Math.max(...numbers(await constraintDef("content_translations", "translation_text")))).toBe(TRANSLATION_MAX_CHARS);
  });
});

describe("names for masking", () => {
  it("NAME_ALT_LENGTH is the database's", async () => {
    const person = numbers(await constraintDef("user", "user_name_alt_len"));
    const contact = numbers(await constraintDef("client_contacts", "contact_name_alt_len"));
    expect([Math.min(...person), Math.max(...person)]).toEqual(NAME_ALT_LENGTH.person);
    expect([Math.min(...contact), Math.max(...contact)]).toEqual(NAME_ALT_LENGTH.contact);
  });

  it("SHORT_NAMES are check_short_names()'s limits", async () => {
    await rolledBack(async (c) => {
      const set = (names: string[]) => refusal(c, `UPDATE organizations SET short_names = $2 WHERE id = $1`, [ACME, names]);
      const word = (n: number) => "x".repeat(n);
      expect(await set(Array.from({ length: SHORT_NAMES.count }, (_, i) => `${word(SHORT_NAMES.min)}${i}`))).toBeNull();
      expect(await set([word(SHORT_NAMES.min), word(SHORT_NAMES.max)])).toBeNull();
      expect(await set(Array.from({ length: SHORT_NAMES.count + 1 }, (_, i) => `${word(SHORT_NAMES.min)}${i}`))).not.toBeNull();
      expect(await set([word(SHORT_NAMES.min - 1)])).not.toBeNull();
      expect(await set([word(SHORT_NAMES.max + 1)])).not.toBeNull();
    });
  });

  it("PHASE_LIMITS are the database's", async () => {
    const seq = numbers(await constraintDef("projects", "projects_sequence_range"));
    const days = numbers(await constraintDef("projects", "projects_planned_days_range"));
    expect([Math.min(...seq), Math.max(...seq)]).toEqual([PHASE_LIMITS.sequence.min, PHASE_LIMITS.sequence.max]);
    expect([Math.min(...days), Math.max(...days)]).toEqual([PHASE_LIMITS.plannedWorkingDays.min, PHASE_LIMITS.plannedWorkingDays.max]);
  });
});

# Authorization

Selah decides access on the server from **organization + role + engagement membership + assignment + visibility label**. A role alone never grants access, and hiding a button is never the control.

There are two layers. Both must allow a request.

| Layer | Where | What it decides |
|---|---|---|
| `authorize()` | `apps/web/src/authz/authorize.ts` | Everything: the five questions below, per permission |
| Row-level security | `apps/web/drizzle/0001_security.sql` | Backstop: tenant, engagement and label isolation, plus "only the firm can review" |

## The five questions

`authorize(principal, permission, resource)` asks, in order, and the first "no" denies:

1. **Organization.** Client users reach only their own tenant. firm staff reach client records only through an engagement their org runs.
2. **Role.** Does `POLICY[permission]` grant this role anything? (`src/authz/policy.ts`)
3. **Engagement membership.** The firm lead and a client admin see all engagements of their org; everyone else must be a member.
4. **Scope of the grant.** `any`, `assigned` (e.g. action owners and their actions), `own`, `shared` (explicit per-user shares), or `owner_org` (who controls a document's labels and AI flag).
5. **Visibility label.** `shared`, `firm_private` (the firm only), `client_private` (that client only, not even the firm lead), `user_private` (creator only).

The `Principal` is built from the session and the database (`services/principal.ts`), never from anything the browser sends.

## How a request flows

```
route()  ─ CSRF origin check, session, Zod validation
  └─ asUser(userId)  ─ one transaction; set_config('selah.user_id') so RLS applies
       └─ loadPrincipal()
            └─ service  ─ load the row (RLS hides other tenants entirely)
                 └─ assertAllowed(principal, permission, resource)
```

A denial returns **404**, the same as a missing record, so ids cannot be probed, and is written to the audit log.

## Workflow

`src/authz/workflow.ts` lists every allowed status move and the permission it needs:

| Move | Permission | Who |
|---|---|---|
| Draft → Assigned | `action.release` | Lead, consultant |
| Assigned → In Progress, In Progress ↔ Blocked, In Progress → Awaiting Review, Revision Requested → In Progress | `action.work` | Action owner (own actions), client manager |
| Awaiting Review → Verified Complete or Revision Requested | `action.review` | Lead, consultant |

The database trigger `check_action_transition` holds the same list and also requires an `accept` review before Verified Complete. Only firm staff can insert reviews (RLS). So a client claim can never become "verified".

## AI retrieval

`retrievalScope()` turns the same check into a filter (engagement, tenant, allowed labels, user). `services/assistant.ts` puts that filter **inside** the pgvector query's `WHERE`, and the query also runs under RLS. Chunks are deleted by trigger when a document's AI flag is turned off, its label changes, or it is archived. The AI service only receives the passages that survived.

Client roles do not get the assistant yet: that is an open decision in the spec. To enable client managers, add `client_manager: "any"` to `assistant.query` in `policy.ts`; nothing else changes. Action owners stay excluded because their document access is per-user shares, which the index does not carry.

## Adding a new record type (checklist)

1. Add the table in `src/db/schema/app.ts` with `engagement_id`, `client_org_id` (via `scoped()` and `scopedFk()`) and, if it can be private, `visibility`.
2. `npm run db:generate`, then add grants and an RLS policy in a new custom migration (`npx drizzle-kit generate --custom`). Without them the app role cannot touch the table. `tests/db/rls.test.ts` fails if RLS is off.
3. Add permissions to `POLICY` with the narrowest grants that work.
4. Write the service: load the row, build the `Resource`, call `assertAllowed()`.
5. Expose it with `route()`.
6. Add allow **and** deny tests: other tenant, other engagement, wrong role, wrong label.

## Rules that are proposals

Several rules here are tagged **[Proposed]** in the spec (for example: the lead cannot see client-private documents, client managers only request deadline changes, action owners see documents only when shared). They are implemented so they can be tested, but the team should confirm them before the report presents them as requirements.

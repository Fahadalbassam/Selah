import "server-only";
import { headers as nextHeaders } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth/auth";
import { ForbiddenError, type Principal } from "@/authz";
import { asUser, type Tx } from "@/db/client";
import { env } from "@/env";
import { auditDetached } from "@/services/audit";
import { loadPrincipal } from "@/services/principal";
import { BadRequestError, ConflictError, NotFoundError, UnavailableError } from "./errors";

/**
 * The only way to write an API route. Every handler built with route():
 *
 *   - rejects cross-site writes (CSRF: Origin must be this app)      ASVS V4
 *   - requires a valid session                                       ASVS V7
 *   - builds the Principal from the database, not from the request   ASVS V8
 *   - validates params and body with Zod                             ASVS V2
 *   - runs the handler in one transaction as the user, so Postgres
 *     row-level security applies to every query                      ASVS V8
 *   - turns authorization failures into 404 (no existence leaks) and
 *     records them in the audit log                                  ASVS V16
 *   - never returns stack traces or internal messages                ASVS V16
 *
 * tests/route-guard.test.ts fails the build if a route skips this wrapper.
 */
export interface Context<P, B, R = undefined> {
  principal: Principal;
  tx: Tx;
  params: P;
  body: B;
  /** Files from a multipart form (only when the route sets `form`). */
  files: Map<string, File>;
  /** What `prepare` returned. */
  prepared: R;
  ip: string | null;
}

interface Options<P extends z.ZodType, B extends z.ZodType, R> {
  params?: P;
  /** JSON body schema. */
  body?: B;
  /** Multipart form instead of JSON: `body` then validates the text fields. */
  form?: { maxBytes: number };
  /**
   * Slow work on the input (e.g. a virus scan) that must not hold a database
   * connection. Runs after the session and input checks, before the
   * transaction opens; it must not read data or make access decisions.
   */
  prepare?: (input: { userId: string; params: z.infer<P>; body: z.infer<B>; files: Map<string, File> }) => Promise<R>;
}

type Handler<P, B, R> = (ctx: Context<P, B, R>) => Promise<unknown>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function route<P extends z.ZodType = z.ZodUndefined, B extends z.ZodType = z.ZodUndefined, R = undefined>(
  options: Options<P, B, R>,
  handler: Handler<z.infer<P>, z.infer<B>, R>,
) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string | string[]>> }) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    let userId: string | null = null;
    try {
      if (!SAFE_METHODS.has(req.method) && !sameOrigin(req)) {
        return json({ error: "forbidden" }, 403);
      }

      const session = await auth().api.getSession({ headers: await nextHeaders() });
      if (!session) return json({ error: "unauthenticated" }, 401);
      userId = session.user.id;
      const uid = userId;

      const params = parse(options.params, await segment.params);
      const files = new Map<string, File>();
      let raw: unknown;
      if (options.form) {
        const form = await readForm(req, options.form.maxBytes);
        const fields: Record<string, string> = {};
        for (const [key, value] of form) {
          if (typeof value === "string") fields[key] = value;
          else files.set(key, value);
        }
        raw = fields;
      } else if (options.body) {
        raw = await readJson(req);
      }
      const body = options.body ? parse(options.body, raw) : undefined;

      const prepared = options.prepare
        ? await options.prepare({ userId: uid, params: params as z.infer<P>, body: body as z.infer<B>, files })
        : undefined;

      const result = await asUser(uid, async (tx) => {
        const principal = await loadPrincipal(tx, uid);
        if (!principal) throw new NoMembershipError();
        return handler({ principal, tx, params: params as z.infer<P>, body: body as z.infer<B>, files, prepared: prepared as R, ip });
      });
      return result instanceof Response ? result : json(result ?? { ok: true }, 200);
    } catch (err) {
      return toErrorResponse(err, userId, ip, req);
    }
  };
}

class NoMembershipError extends Error {}

function parse<T extends z.ZodType>(schema: T | undefined, value: unknown): z.infer<T> | undefined {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestError("invalid input");
  return result.data;
}

async function readJson(req: NextRequest): Promise<unknown> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new BadRequestError("expected JSON");
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("invalid JSON");
  }
}

async function readForm(req: NextRequest, maxBytes: number): Promise<FormData> {
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data")) throw new BadRequestError("expected a form");
  // Refuse oversized requests before reading them. Room is left for the form's own overhead.
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > maxBytes + 64 * 1024) throw new BadRequestError("file too large");
  try {
    return await req.formData();
  } catch {
    throw new BadRequestError("invalid form");
  }
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) return origin === new URL(env().APP_URL).origin;
  // Browsers always send Origin on cross-site POSTs; fall back to Fetch Metadata.
  return req.headers.get("sec-fetch-site") === "same-origin";
}

async function toErrorResponse(err: unknown, userId: string | null, ip: string | null, req: NextRequest) {
  if (err instanceof ForbiddenError) {
    await auditDetached({
      actorId: userId,
      action: err.permission,
      resourceType: err.resource.type,
      resourceId: err.resource.id,
      outcome: "deny",
      reason: err.reason,
      ip,
    }).catch(() => undefined);
    // Same answer as "does not exist", so ids cannot be probed.
    return json({ error: "not_found" }, 404);
  }
  if (err instanceof NotFoundError) return json({ error: "not_found" }, 404);
  if (err instanceof NoMembershipError) return json({ error: "forbidden" }, 403);
  if (err instanceof BadRequestError) return json({ error: "bad_request", message: err.message }, 400);
  if (err instanceof ConflictError) return json({ error: "conflict", message: err.message }, 409);
  if (err instanceof UnavailableError) return json({ error: "unavailable", message: err.message }, 503);
  // A database rule refused the write (the app's own checks should have
  // caught it first). Row-level security answers like a missing record.
  const code = pgCode(err);
  if (code === "42501") return json({ error: "not_found" }, 404);
  if (code === "23514" || code === "23505") return json({ error: "conflict", message: "refused by a data rule" }, 409);
  console.error(`[api] ${req.method} ${req.nextUrl.pathname} failed`, err);
  return json({ error: "internal_error" }, 500);
}

function pgCode(err: unknown): string | undefined {
  for (let e = err; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

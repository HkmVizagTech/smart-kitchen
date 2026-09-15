// Route guards.
//
// Before this file, every /admin, /orders, /packing and /verification route was
// open to the public internet — the user list, password resets and packing
// factors could all be read and changed with no token at all. Each route now
// declares who may call it.
//
// Usage:
//   app.get("/admin/units", { preHandler: requireRole("SUPER_ADMIN") }, handler)
//   app.get("/orders",      { preHandler: requireAuth },                handler)
//
// Inside a handler, `req.session` is the verified session (never trust ids sent
// in the body — read them from here).

import type { FastifyReply, FastifyRequest } from "fastify";
import { verify, type Session } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

export const ROLES = ["BOOKING", "KITCHEN_ADMIN", "VERIFICATION_ADMIN", "SUPER_ADMIN"] as const;
export type RoleName = (typeof ROLES)[number];

/**
 * Pull a session off a request.
 *
 * Normally the token arrives as `Authorization: Bearer <token>`. File
 * downloads are the exception: the Excel link is a plain <a href>, and a
 * browser navigation cannot carry a custom header, so `?token=` is also
 * accepted. Only download routes should rely on that.
 */
export function sessionFrom(req: FastifyRequest): Session | null {
  const header = (req.headers.authorization ?? "").trim();
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const fromQuery = typeof (req.query as any)?.token === "string" ? (req.query as any).token : "";
  return verify(bearer || fromQuery);
}

/** Any signed-in user. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const session = sessionFrom(req);
  if (!session) return reply.code(401).send({ error: "Sign in to continue." });
  req.session = session;
}

/** Signed in AND holding one of these roles. SUPER_ADMIN always passes. */
export function requireRole(...roles: RoleName[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const session = sessionFrom(req);
    if (!session) return reply.code(401).send({ error: "Sign in to continue." });
    if (session.role !== "SUPER_ADMIN" && !roles.includes(session.role as RoleName)) {
      return reply.code(403).send({ error: "Your account doesn't have access to this." });
    }
    req.session = session;
  };
}

/** The verified session inside a guarded handler. */
export function must(req: FastifyRequest): Session {
  if (!req.session) throw new Error("Route is missing an auth guard.");
  return req.session;
}

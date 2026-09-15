// A small in-memory rate limiter for the credential routes.
//
// /auth/login is the one endpoint that is public, unauthenticated and worth
// attacking: passwords can otherwise be guessed as fast as the network allows.
// This caps attempts per IP.
//
// Deliberately dependency-free and in-process — the API runs as a single
// replica, so a Map is enough and it adds nothing to the deploy. If the API is
// ever scaled to multiple replicas, each gets its own counter and the effective
// limit multiplies; swap in @fastify/rate-limit with a Redis store at that point.

import type { FastifyReply, FastifyRequest } from "fastify";

interface Bucket {
  count: number;
  /** Unix ms when this bucket resets. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Drop expired buckets occasionally so the Map cannot grow without bound.
const SWEEP_EVERY_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, SWEEP_EVERY_MS).unref?.();

function clientKey(req: FastifyRequest): string {
  // Railway sits behind a proxy, so the real client is the first entry in
  // x-forwarded-for. Fall back to the socket address.
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fwd || req.ip || "unknown";
}

/**
 * Allow `limit` requests per `windowMs` per client, per route.
 *
 *   app.post("/auth/login", { preHandler: rateLimit({ limit: 10, windowMs: 60_000 }) }, ...)
 */
export function rateLimit({ limit, windowMs }: { limit: number; windowMs: number }) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    if (limit <= 0) return; // disabled
    const key = `${req.routeOptions?.url ?? req.url}:${clientKey(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      reply.header("Retry-After", String(retryAfter));
      return reply
        .code(429)
        .send({ error: `Too many attempts. Try again in ${retryAfter} seconds.` });
    }
  };
}

// Token helper.
// A token is base64url(payload) + "." + HMAC(payload). Signed with AUTH_SECRET,
// which MUST be set in production — an unset secret used to fall back to
// "dev-secret", which meant anyone who read this file could forge an admin
// session. The server now refuses to start instead.

import crypto from "node:crypto";

const SECRET = process.env.AUTH_SECRET ?? "";
const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;

if (!SECRET && IS_PROD) {
  throw new Error(
    "AUTH_SECRET is not set. Add it as a Railway variable on the api service before deploying."
  );
}
const EFFECTIVE_SECRET = SECRET || "dev-only-insecure-secret";

// How long a login lasts. Tokens used to never expire and could not be revoked.
const TOKEN_TTL_DAYS = Number(process.env.TOKEN_TTL_DAYS ?? 30);

export interface Session {
  userId: number;
  role: string;
  unitId: number | null;
  /** Unix seconds. Added at sign time; tokens without one are rejected. */
  exp?: number;
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", EFFECTIVE_SECRET).update(payload).digest("base64url");
}

export function sign(session: Omit<Session, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_DAYS * 86_400;
  const payload = Buffer.from(JSON.stringify({ ...session, exp })).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function verify(token: string): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  // Constant-time compare so a wrong signature leaks nothing through timing.
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof session?.userId !== "number" || typeof session?.role !== "string") return null;
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

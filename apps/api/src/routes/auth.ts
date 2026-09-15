import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "@sk/db";
import { sign, verify } from "../auth.js";
import { rateLimit } from "../rateLimit.js";

// Limits are env-tunable: the defaults suit a small internal tool, but tests
// and load checks need to raise them, and a bigger deployment may want them
// tighter. Set to 0 to disable a limit entirely.
const LOGIN_LIMIT = Number(process.env.LOGIN_RATE_LIMIT ?? 10);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS ?? 60_000);
const SIGNUP_LIMIT = Number(process.env.SIGNUP_RATE_LIMIT ?? 5);
const SIGNUP_WINDOW_MS = Number(process.env.SIGNUP_RATE_WINDOW_MS ?? 60 * 60_000);

// Roles a stranger may create for themselves. Everything else — kitchen,
// verification and especially SUPER_ADMIN — is created by a Super Admin from
// the admin console. Public signup previously accepted any role from the
// request body, so anyone on the internet could make themselves an admin.
const SELF_SIGNUP_ROLES = (process.env.SELF_SIGNUP_ROLES ?? "BOOKING")
  .split(",")
  .map((r) => r.trim().toUpperCase())
  .filter(Boolean);

function publicUser(u: any) {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    username: u.username,
    email: u.email,
    phone: u.phone,
    photo: u.photo,
    iskconRole: u.iskconRole,
    centre: u.centre,
    address: u.address,
    unitId: u.unitId,
  };
}

export default async function authRoutes(app: FastifyInstance) {
  // Create an account. Role is fixed by which app/link the person used.
  app.post<{
    Body: {
      role: string;
      username: string;
      password: string;
      name: string;
      email?: string;
      phone?: string;
      iskconRole?: string;
      centre?: string;
      address?: string;
      photo?: string;
    };
  }>("/auth/signup", { preHandler: rateLimit({ limit: SIGNUP_LIMIT, windowMs: SIGNUP_WINDOW_MS }) }, async (req, reply) => {
    const b = req.body;
    if (!SELF_SIGNUP_ROLES.includes(String(b.role).toUpperCase()))
      return reply.code(403).send({
        error: "Accounts for this app are created by a Super Admin. Ask them to add you.",
      });
    if (!b.username || !b.password || !b.name)
      return reply.code(422).send({ error: "Username, password and full name are required." });
    if (b.password.length < 8)
      return reply.code(422).send({ error: "Password must be at least 8 characters." });

    const clean = (s?: string) => (s && s.trim() ? s.trim() : null);
    try {
      const user = await prisma.user.create({
        data: {
          role: b.role as any,
          username: b.username.trim().toLowerCase(),
          passwordHash: await bcrypt.hash(b.password, 10),
          name: b.name.trim(),
          email: clean(b.email)?.toLowerCase() ?? null,
          phone: clean(b.phone),
          iskconRole: clean(b.iskconRole),
          centre: clean(b.centre),
          address: clean(b.address),
          photo: b.photo ?? null,
        },
      });
      return { token: sign({ userId: user.id, role: user.role, unitId: user.unitId }), user: publicUser(user) };
    } catch (e: any) {
      if (e.code === "P2002") {
        const f = e.meta?.target?.[0] ?? "username/email/phone";
        return reply.code(409).send({ error: `That ${f} is already registered.` });
      }
      throw e;
    }
  });

  // Log in with username OR email OR phone + password.
  app.post<{ Body: { identifier: string; password: string } }>(
    "/auth/login",
    { preHandler: rateLimit({ limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS }) },
    async (req, reply) => {
    const id = (req.body.identifier ?? "").trim();
    const idLower = id.toLowerCase();
    if (!id || !req.body.password) return reply.code(422).send({ error: "Enter your login and password." });
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: idLower }, { email: idLower }, { phone: id }] },
    });
    if (!user || !user.active || user.deletedAt || !(await bcrypt.compare(req.body.password, user.passwordHash)))
      return reply.code(401).send({ error: "Invalid login or password." });
    return { token: sign({ userId: user.id, role: user.role, unitId: user.unitId }), user: publicUser(user) };
    }
  );

  // Current user from token.
  app.get("/auth/me", async (req, reply) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const session = verify(token);
    if (!session) return reply.code(401).send({ error: "Not signed in." });
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return reply.code(401).send({ error: "Account not found." });
    return { user: publicUser(user) };
  });
}

import Fastify from "fastify";
import cors from "@fastify/cors";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import packingRoutes from "./routes/packing.js";
import adminRoutes from "./routes/admin.js";
import menuAdminRoutes from "./routes/menuAdmin.js";
import notificationRoutes from "./routes/notifications.js";
import updateRoutes from "./routes/updates.js";

// trustProxy: 1 = trust exactly one proxy hop (Railway's edge) when working
// out req.ip. It must be a hop COUNT, not `true`: trusting every hop means
// believing whatever X-Forwarded-For a client sends, which would let anyone
// bypass the login rate limit by making up a new address each request.
//
// The count must match how many proxies actually sit in front of the app. Too
// high and forged addresses are believed again; too low and req.ip resolves to
// a platform-internal address that every client shares, so one person hitting
// the limit locks out everybody. Raise TRUSTED_PROXY_HOPS if the platform adds
// hops. Locally there is no proxy at all, so req.ip is just the socket.
const app = Fastify({
  logger: true,
  bodyLimit: 40 * 1024 * 1024,
  trustProxy: Number(process.env.TRUSTED_PROXY_HOPS ?? 1),
});

await app.register(cors, { origin: true });

// Accept raw zip uploads (OTA bundles) as a Buffer.
app.addContentTypeParser(
  ["application/zip", "application/octet-stream"],
  { parseAs: "buffer" },
  (_req, body, done) => done(null, body)
);

app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

// Every write handler reads fields straight off req.body. A JSON body of `null`
// or `[]` or a bare string parses fine, so the handler then reads a field off
// something that has none and throws a TypeError, which surfaces as a bare
// "something went wrong". Rejecting it here answers it once, for every route.
app.addHook("preValidation", async (req, reply) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return;
  const ct = String(req.headers["content-type"] ?? "");
  if (!ct.includes("json")) return;   // raw uploads parse to a Buffer, by design
  const b = req.body;
  if (b === undefined) return;        // a body-less request is a route's own business
  if (b === null || typeof b !== "object" || Array.isArray(b))
    return reply.code(400).send({ error: "The request was not in the expected format." });
});

// Unhandled errors are logged in full and answered in one line.
//
// Fastify's default reply forwards the thrown error's message, and Prisma's
// messages name tables and columns: a missing-table error reached the booking
// screen reading "The table `public.MenuSlot` does not exist in the current
// database." That is a map of the schema handed to anyone who can sign in, and
// it tells the person reading it nothing they can act on. The detail stays in
// the server log, where whoever is fixing it will look.
//
// Database errors are the exception. A record that was deleted in another tab,
// a name that is already taken, a row something else still points at, or a
// number where the form sent a word — all of those are the person's situation,
// not a fault at our end, and telling them "something went wrong" sends them to
// find someone to ask. They are answered as what they are, still without naming
// a table or a column.
const PRISMA_MESSAGE: Record<string, { code: number; message: string }> = {
  // Record not found, for an update or delete.
  P2025: { code: 404, message: "That item no longer exists. Refresh and try again." },
  // Unique constraint — something with this name or login already exists.
  P2002: { code: 409, message: "Something with those details already exists." },
  // Foreign key — still referenced by other records.
  P2003: { code: 409, message: "That is still being used elsewhere, so it cannot be changed or removed." },
  // Required value missing.
  P2011: { code: 400, message: "Some required details were missing." },
  P2012: { code: 400, message: "Some required details were missing." },
};

app.setErrorHandler((err, req, reply) => {
  const code = (err as { code?: string }).code;
  const known = code ? PRISMA_MESSAGE[code] : undefined;
  if (known) {
    req.log.warn({ err: { code, message: err.message } }, "database rejected the request");
    return reply.code(known.code).send({ error: known.message });
  }
  // Prisma's own validation failure: wrong type, or a field it does not know.
  // It carries no code, so it is recognised by name.
  if (err.name === "PrismaClientValidationError") {
    req.log.warn({ err: { message: err.message } }, "invalid details sent");
    return reply.code(400).send({ error: "Some of the details sent were not valid. Check the form and try again." });
  }

  const status = err.statusCode ?? 500;
  if (status >= 500) {
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "Something went wrong at our end. It has been logged." });
  }
  // 4xx errors are the app's own, deliberate messages — those are meant to be read.
  return reply.code(status).send({ error: err.message });
});

await app.register(authRoutes);
await app.register(orderRoutes);
await app.register(packingRoutes);
await app.register(adminRoutes);
await app.register(menuAdminRoutes);
await app.register(notificationRoutes);
await app.register(updateRoutes);

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API on :${port}`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });

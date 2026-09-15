import Fastify from "fastify";
import cors from "@fastify/cors";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import packingRoutes from "./routes/packing.js";
import adminRoutes from "./routes/admin.js";
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

await app.register(authRoutes);
await app.register(orderRoutes);
await app.register(packingRoutes);
await app.register(adminRoutes);
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

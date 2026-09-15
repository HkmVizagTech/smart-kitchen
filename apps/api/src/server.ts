import Fastify from "fastify";
import cors from "@fastify/cors";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import packingRoutes from "./routes/packing.js";
import adminRoutes from "./routes/admin.js";
import notificationRoutes from "./routes/notifications.js";
import updateRoutes from "./routes/updates.js";

const app = Fastify({ logger: true, bodyLimit: 40 * 1024 * 1024 });

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

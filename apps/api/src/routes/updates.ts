import type { FastifyInstance } from "fastify";
import { prisma } from "@sk/db";

const APPS = ["booking", "kitchen", "verification", "admin"];

// Self-hosted OTA. The release script uploads a zipped web bundle here; the
// apps poll /updates/:app/latest and download the zip to update themselves.
export default async function updateRoutes(app: FastifyInstance) {
  // Diagnostic: is UPDATE_SECRET configured on the server? (never returns the value)
  app.get("/updates/_health", async () => ({
    ok: true,
    secretConfigured: !!process.env.UPDATE_SECRET,
    secretLength: process.env.UPDATE_SECRET ? process.env.UPDATE_SECRET.length : 0,
  }));

  // Upload a new bundle (protected by a shared secret).
  app.post<{ Params: { app: string }; Querystring: { version: string } }>(
    "/updates/:app",
    async (req, reply) => {
      const secret = req.headers["x-update-secret"];
      if (!process.env.UPDATE_SECRET || secret !== process.env.UPDATE_SECRET)
        return reply.code(401).send({ error: "Bad or missing update secret." });
      const appKey = req.params.app;
      const version = req.query.version;
      if (!APPS.includes(appKey)) return reply.code(422).send({ error: "Unknown app." });
      if (!version) return reply.code(422).send({ error: "version is required." });
      const data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || data.length === 0)
        return reply.code(422).send({ error: "Empty bundle (send the zip as application/zip)." });
      await prisma.appBundle.create({ data: { app: appKey, version, data } });
      return { ok: true, app: appKey, version, bytes: data.length };
    }
  );

  // Latest bundle info for an app.
  app.get<{ Params: { app: string } }>("/updates/:app/latest", async (req, reply) => {
    const b = await prisma.appBundle.findFirst({
      where: { app: req.params.app },
      orderBy: { createdAt: "desc" },
    });
    if (!b) return reply.code(404).send({ error: "No bundle published yet." });
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const host = req.headers.host;
    return { version: b.version, url: `${proto}://${host}/updates/${b.app}/${b.version}/file` };
  });

  // Serve the bundle zip.
  app.get<{ Params: { app: string; version: string } }>(
    "/updates/:app/:version/file",
    async (req, reply) => {
      const b = await prisma.appBundle.findFirst({
        where: { app: req.params.app, version: req.params.version },
        orderBy: { createdAt: "desc" },
      });
      if (!b) return reply.code(404).send({ error: "Bundle not found." });
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="${b.app}-${b.version}.zip"`);
      return reply.send(Buffer.from(b.data));
    }
  );
}

import { Router } from "express";
import type { Db } from "mongodb";
import type { OwnerMutation } from "../owner-operations.ts";
import type { SessionManager } from "../session-manager.ts";
import { parseSettings } from "../settings.ts";

export function runsRoutes(
  db: Db,
  sessions: SessionManager,
  mutate: OwnerMutation,
) {
  const router = Router();

  router.get("/api/runs", async (req, res) =>
    res.json(
      await db
        .collection("runs")
        .find({ ownerId: req.userId }, { projection: { events: 0 } })
        .sort({ startedAt: -1 })
        .limit(20)
        .toArray(),
    ),
  );

  router.get("/api/runs/:id", async (req, res) => {
    const run = await db
      .collection("runs")
      .findOne({ id: req.params.id, ownerId: req.userId });

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    res.json(run);
  });

  router.post(
    "/api/preview",
    mutate(async (req, res) => {
      const session = await sessions.claim(req.userId);
      await session.preview();
      res.json({ ok: true });
    }),
  );

  router.post(
    "/api/start",
    mutate(async (req, res) => {
      const settings = parseSettings(req.body);
      await sessions.start(req.userId, settings);
      res.status(202).json({ status: "loading" });
    }),
  );

  router.post(
    "/api/stop",
    mutate(async (req, res) => {
      await sessions.stop(req.userId);
      res.json({ status: sessions.state(req.userId).status });
    }),
  );

  return router;
}

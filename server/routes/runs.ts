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

  router.get("/api/runs", async (req, res) => {
    const query = req.query.q ?? "";
    const pageValue = req.query.page ?? "1";
    const limitValue = req.query.limit ?? "20";

    if (typeof query !== "string" || query.length > 100) {
      return res
        .status(400)
        .json({ error: "Search must be text up to 100 characters" });
    }

    if (
      typeof pageValue !== "string" ||
      typeof limitValue !== "string" ||
      !/^\d+$/.test(pageValue) ||
      !/^\d+$/.test(limitValue)
    ) {
      return res.status(400).json({ error: "Invalid pagination" });
    }

    const page = Number(pageValue);
    const limit = Number(limitValue);
    const offset = (page - 1) * limit;

    if (
      !Number.isSafeInteger(page) ||
      !Number.isSafeInteger(limit) ||
      !Number.isSafeInteger(offset) ||
      page < 1 ||
      limit < 1 ||
      limit > 50
    ) {
      return res.status(400).json({ error: "Invalid pagination" });
    }

    const text = query.trim();
    const pattern = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const filter = {
      ownerId: req.userId,
      ...(text
        ? {
            $or: [
              { id: { $regex: pattern, $options: "i" } },
              { "profile.name": { $regex: pattern, $options: "i" } },
              { status: { $regex: pattern, $options: "i" } },
            ],
          }
        : {}),
    };

    const collection = db.collection("runs");

    const [runs, total] = await Promise.all([
      collection
        .find(filter, {
          projection: { events: 0, "profile.arithmeticMode": 0 },
        })
        .sort({ startedAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    res
      .set({
        "X-Total-Count": String(total),
        "X-Page": String(page),
        "X-Page-Size": String(limit),
      })
      .json(runs);
  });

  router.get("/api/runs/:id", async (req, res) => {
    const run = await db
      .collection("runs")
      .findOne(
        { id: req.params.id, ownerId: req.userId },
        { projection: { "profile.arithmeticMode": 0 } },
      );

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

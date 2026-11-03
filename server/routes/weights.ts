import { Router } from "express";
import type { OwnerMutation } from "../owner-operations.ts";
import type { Preferences } from "../preferences.ts";
import type { SessionManager } from "../session-manager.ts";
import type { Weights } from "../weights.ts";

export function weightsRoutes(
  weights: Weights,
  sessions: SessionManager,
  preferences: Preferences,
  mutate: OwnerMutation,
) {
  const router = Router();

  router.get("/api/weights", async (req, res) =>
    res.json(await weights.list(req.userId, req.query.q ?? "")),
  );

  router.post(
    "/api/weights",
    mutate(async (req, res) => {
      if (!req.is("application/octet-stream")) {
        return res
          .status(415)
          .json({ error: "Upload NPZ weights as application/octet-stream" });
      }

      res.status(201).json(await weights.upload(req, req.userId));
    }),
  );

  router.get("/api/weights/:id/file", async (req, res) =>
    weights.download(await weights.get(req.userId, req.params.id), res),
  );

  router.delete(
    "/api/weights/:id",
    mutate(async (req, res) => {
      const current = sessions.current;

      if (
        current?.ownerId === req.userId &&
        (current.session.running || current.session.previewing)
      ) {
        return res
          .status(409)
          .json({ error: "Stop the run before removing weights" });
      }

      await weights.remove(req.userId, req.params.id);

      await preferences.resetProfile(req.userId, req.params.id);

      res.json({ ok: true });
    }),
  );

  return router;
}

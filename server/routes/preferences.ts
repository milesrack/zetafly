import { Router } from "express";
import type { Preferences } from "../preferences.ts";

export function preferencesRoutes(preferences: Preferences) {
  const router = Router();

  router.get("/api/preferences", async (req, res) =>
    res.json(await preferences.get(req.userId)),
  );
  router.put("/api/preferences", async (req, res) =>
    res.json(await preferences.save(req.userId, req.body)),
  );

  return router;
}

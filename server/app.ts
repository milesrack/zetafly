import express, { type ErrorRequestHandler } from "express";
import type { Db } from "mongodb";
import type { accessVerifier } from "./access.ts";
import type { createAuth } from "./auth.ts";
import type { readConfig } from "./config.ts";
import { asError } from "./errors.ts";
import { type OwnerMutation, OwnerOperations } from "./owner-operations.ts";
import { Preferences } from "./preferences.ts";
import { accessRoutes, authRoutes } from "./routes/access.ts";
import { preferencesRoutes } from "./routes/preferences.ts";
import { runsRoutes } from "./routes/runs.ts";
import { weightsRoutes } from "./routes/weights.ts";
import { securityHeaders } from "./security.ts";
import type { SessionManager } from "./session-manager.ts";
import type { Weights } from "./weights.ts";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export type AppDependencies = {
  db: Db;
  auth: ReturnType<typeof createAuth>;
  weights: Weights;
  sessions: SessionManager;
  identify: ReturnType<typeof accessVerifier>;
  config: ReturnType<typeof readConfig>;
  disconnectSession: (id: string) => void;
  operations?: OwnerOperations;
};

export function createApp({
  db,
  auth,
  weights,
  sessions,
  identify,
  config,
  disconnectSession,
  operations = new OwnerOperations(),
}: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");

  app.set("trust proxy", config.publicDeployment ? 1 : false);

  app.use(securityHeaders(config.publicDeployment));

  app.use((req, _res, next) => {
    req.headers["x-zetafly-client-ip"] = req.ip;
    next();
  });

  app.use(authRoutes(auth, sessions, disconnectSession, operations));

  app.use(express.json({ limit: "8kb" }));

  const origins = new Set(config.origins);

  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");

    if (origin && !origins.has(origin)) {
      return res.status(403).json({ error: "Origin rejected" });
    }

    next();
  });

  app.get("/api/health", async (_req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.get("/api/public-config", (_req, res) =>
    res.json({
      localInbox: process.env.RESEND_API_KEY ? null : "http://localhost:8025",
    }),
  );

  app.use(accessRoutes(auth));

  app.use("/api", async (req, res, next) => {
    const identity = await identify(req);

    if (!identity) {
      return res.status(401).json({ error: "Log in to use Zetafly" });
    }

    req.userId = identity.user.id;
    next();
  });

  const preferences = new Preferences(db, weights);
  const mutate: OwnerMutation = (handler) => async (req, res) => {
    await operations.run(req.userId, async () => {
      // A queued request may have authenticated before this account was deleted.
      if (!(await identify(req))) {
        res.status(401).json({ error: "Log in to use Zetafly" });

        return;
      }

      await handler(req, res);
    });
  };

  app.use(preferencesRoutes(preferences, mutate));
  app.use(weightsRoutes(weights, sessions, preferences, mutate));
  app.use(runsRoutes(db, sessions, mutate));

  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown endpoint" }),
  );

  app.use(express.static("web/dist"));

  const handleError: ErrorRequestHandler = (
    value: unknown,
    _req,
    res,
    _next,
  ) => {
    const error = asError(value);

    if (res.headersSent) {
      res.destroy();

      return;
    }

    const status = error.status ?? (error instanceof SyntaxError ? 400 : 500);

    if (status >= 500) {
      console.error(error.message);
    }

    res.status(status).json({
      error:
        status === 500 ? "The request could not be completed" : error.message,
    });
  };

  app.use(handleError);

  return app;
}

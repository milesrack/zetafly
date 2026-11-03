import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { type Request, Router } from "express";
import { ACCESS_COOKIE, cookieOptions } from "../access.ts";
import type { createAuth } from "../auth.ts";
import type { OwnerOperations } from "../owner-operations.ts";
import type { SessionManager } from "../session-manager.ts";

type Auth = ReturnType<typeof createAuth>;
const cookieSession = (auth: Auth, req: Request) =>
  auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

export function authRoutes(
  auth: Auth,
  sessions: SessionManager,
  disconnectSession: (id: string) => void,
  operations: OwnerOperations,
) {
  const router = Router();

  router.post("/api/auth/delete-user", async (req, res) => {
    const identity = await cookieSession(auth, req);
    const handle = toNodeHandler(async (request) => {
      const response = await auth.handler(request);

      if (response.ok) {
        response.headers.append(
          "set-cookie",
          `${ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${cookieOptions.secure ? "; Secure" : ""}`,
        );
      }

      return response;
    });

    if (!identity) {
      await handle(req, res);

      return;
    }

    await operations.run(identity.user.id, async () => {
      await handle(req, res);
    });
  });

  router.post("/api/auth/sign-out", async (req, res, next) => {
    const identity = await cookieSession(auth, req);
    res.clearCookie(ACCESS_COOKIE, cookieOptions);

    if (identity) {
      res.once("finish", () => {
        if (res.statusCode < 300) {
          disconnectSession(identity.session.id);

          sessions.stop(identity.user.id).catch(() => {});
        }
      });
    }

    next();
  });

  router.all("/api/auth/*splat", toNodeHandler(auth));

  return router;
}

export function accessRoutes(auth: Auth) {
  const router = Router();

  router.post("/api/access", async (req, res) => {
    const identity = await cookieSession(auth, req);

    if (!identity) {
      return res.status(401).json({ error: "Log in to use Zetafly" });
    }

    if (!identity.user.emailVerified) {
      return res
        .status(403)
        .json({ error: "Verify your email before continuing" });
    }

    const { token } = await auth.api.getToken({
      headers: fromNodeHeaders(req.headers),
    });

    res.cookie(ACCESS_COOKIE, token, { ...cookieOptions, maxAge: 300000 });
    res.json({ ok: true });
  });

  return router;
}

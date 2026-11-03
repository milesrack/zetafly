import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins/jwt";
import type { Db } from "mongodb";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../shared/password-policy.ts";
import { readConfig } from "./config.ts";
import { deleteAccountData } from "./delete-account.ts";
import { sendAccountEmail } from "./email.ts";
import { ACCOUNT_EMAIL_TTL } from "./email-policy.ts";
import { checkNewPassword } from "./password-check.ts";

export function createAuth(
  db: Db,
  beforeDelete: (ownerId: string) => Promise<void> = async () => {},
) {
  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error("Run node scripts/setup-env.ts before starting Zetafly");
  }

  const config = readConfig();

  return betterAuth({
    appName: "Zetafly",
    baseURL: config.origin,
    secret: process.env.BETTER_AUTH_SECRET,
    database: mongodbAdapter(db),
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path.startsWith("/delete-user/")) {
          throw new APIError("NOT_FOUND", { message: "Not found" });
        }

        if (
          context.path === "/delete-user" &&
          (typeof context.body?.password !== "string" ||
            !context.body.password ||
            context.body.password.length > MAX_PASSWORD_LENGTH ||
            context.body.token)
        ) {
          throw new APIError("BAD_REQUEST", {
            code: "PASSWORD_REQUIRED",
            message: "Enter your current password to delete your account.",
          });
        }

        if (
          ["/sign-up/email", "/reset-password", "/change-password"].includes(
            context.path,
          )
        ) {
          await checkNewPassword(
            context.path === "/sign-up/email"
              ? context.body?.password
              : context.body?.newPassword,
          );
        }

        if (
          ["/sign-up/email", "/update-user"].includes(context.path) &&
          typeof context.body?.name === "string"
        ) {
          const name = context.body.name.trim();

          if (!name || name.length > 80) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_NAME",
              message: "Enter a name between 1 and 80 characters.",
            });
          }

          return { context: { body: { ...context.body, name } } };
        }
      }),
    },
    advanced: { ipAddress: { ipAddressHeaders: ["x-zetafly-client-ip"] } },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          try {
            await beforeDelete(user.id);
          } catch (error) {
            if (
              error instanceof Error &&
              "status" in error &&
              error.status === 409
            ) {
              throw new APIError("CONFLICT", { message: error.message });
            }

            throw error;
          }

          await deleteAccountData(db, user.id);
        },
      },
    },
    plugins: [
      jwt({
        jwt: {
          audience: "zetafly-api",
          expirationTime: "5m",
          definePayload: ({ session }) => ({ sid: session.id }),
        },
        jwks: { rotationInterval: 2592000, gracePeriod: 600 },
      }),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: ACCOUNT_EMAIL_TTL.reset,
      sendResetPassword: ({ user, url }) =>
        sendAccountEmail(user.email, url, "reset"),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: ACCOUNT_EMAIL_TTL.verification,
      sendVerificationEmail: ({ user, url }) =>
        sendAccountEmail(user.email, url, "verification"),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 },
        "/delete-user": { window: 60, max: 5 },
      },
    },
    trustedOrigins: config.origins,
  });
}

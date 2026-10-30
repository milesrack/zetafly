import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { MongoClient } from "mongodb";
import { createAuth } from "../server/auth.ts";
import type { AccountResponse } from "./verification-types.ts";

if (process.env.RESEND_API_KEY) {
  throw Error(
    "Run this fixture with local Mailpit delivery, not a production email key",
  );
}

const client = new MongoClient(
  process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017",
);

await client.connect();

const originalFetch = globalThis.fetch;
let breachResponse: string | null = `${"0".repeat(35)}:0`;

globalThis.fetch = (url, options) =>
  String(url).startsWith("https://api.pwnedpasswords.com/range/")
    ? breachResponse === null
      ? Promise.reject(Error("Fixture outage"))
      : Promise.resolve(new Response(breachResponse))
    : originalFetch(url, options);

const suffix = randomBytes(8).toString("hex");
const db = client.db(`zetafly_security_${suffix}`);
const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const password = randomBytes(24).toString("base64url");
let count = 0;

try {
  await db.collection("user").createIndex({ email: 1 }, { unique: true });
  const auth = createAuth(db);

  async function send(
    path: string,
    body: unknown,
    ip = `192.0.2.${++count}`,
    cookie = "",
  ) {
    const response = await auth.handler(
      new Request(`${base}/api/auth/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          "x-zetafly-client-ip": ip,
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      }),
    );

    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
      `Non-JSON response for ${path}: ${response.status}`,
    );

    return { response, body: (await response.json()) as AccountResponse };
  }

  const email = `security-${suffix}@example.test`;
  const fields = {
    name: "  Security QA  ",
    email: email.toUpperCase(),
    password,
    callbackURL: `${base}/`,
  };
  const created = await send("sign-up/email", fields);
  assert.equal(created.response.status, 200);
  assert.equal(created.body.user.name, "Security QA");
  const user = await db.collection("user").findOne({ email });
  assert.ok(user);
  assert.equal(user.emailVerified, false);
  const account = await db.collection("account").findOne({ userId: user._id });
  assert.ok(account?.password);
  assert.notEqual(account.password, password);

  assert.equal(
    await verifyPassword({ hash: account.password, password }),
    true,
  );

  const duplicate = await send("sign-up/email", { ...fields, email });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.token, null);
  assert.equal(await db.collection("user").countDocuments({ email }), 1);

  await assert.rejects(
    db.collection("user").insertOne({ email }),
    (error) =>
      error instanceof Error && "code" in error && error.code === 11000,
  );

  for (const invalid of [
    { name: " " },
    { name: "x".repeat(81) },
    { email: "not-an-email" },
    { password: "a".repeat(14) },
    { password: "a".repeat(129) },
  ]) {
    const result = await send("sign-up/email", {
      ...fields,
      email: `invalid-${++count}-${suffix}@example.test`,
      ...invalid,
    });

    assert.equal(result.response.status, 400);
  }

  const longPassword = randomBytes(96).toString("base64url");
  const longEmail = `long-${suffix}@example.test`;
  const longSignup = await send("sign-up/email", {
    ...fields,
    email: longEmail,
    password: longPassword,
  });

  assert.equal(longSignup.response.status, 200);
  const longUser = await db.collection("user").findOne({ email: longEmail });
  const longAccount = await db
    .collection("account")
    .findOne({ userId: longUser!._id });

  assert.equal(
    await verifyPassword({
      hash: longAccount!.password,
      password: longPassword,
    }),
    true,
  );

  assert.equal(
    await verifyPassword({
      hash: longAccount!.password,
      password: longPassword.slice(0, 127),
    }),
    false,
    "Long passwords must not be truncated",
  );

  for (const path of ["sign-up/email", "reset-password", "change-password"]) {
    const rejected = await send(path, {
      ...fields,
      password: "a".repeat(15),
      newPassword: "a".repeat(15),
      currentPassword: password,
      token: "invalid",
    });

    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.code, "PASSWORD_TOO_WEAK");
  }

  const exposed = "correct horse battery staple";

  breachResponse =
    createHash("sha1").update(exposed).digest("hex").toUpperCase().slice(5) +
    ":9";

  for (const path of ["sign-up/email", "reset-password", "change-password"]) {
    const rejected = await send(path, {
      ...fields,
      password: exposed,
      newPassword: exposed,
      currentPassword: password,
      token: "invalid",
    });

    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.code, "PASSWORD_COMPROMISED");
  }

  breachResponse = null;

  const unavailable = await send("sign-up/email", {
    ...fields,
    email: `outage-${suffix}@example.test`,
  });

  assert.equal(unavailable.response.status, 503);
  assert.equal(unavailable.body.code, "PASSWORD_CHECK_UNAVAILABLE");

  assert.equal(
    await db
      .collection("user")
      .countDocuments({ email: `outage-${suffix}@example.test` }),
    0,
  );

  breachResponse = `${"0".repeat(35)}:0`;

  const wrong = await send("sign-in/email", {
    email,
    password: "wrong-password",
  });
  const missing = await send("sign-in/email", {
    email: `missing-${suffix}@example.test`,
    password: "wrong-password",
  });

  assert.equal(wrong.response.status, 401);
  assert.equal(missing.response.status, 401);
  assert.equal(wrong.body.code, missing.body.code);
  assert.equal(wrong.body.message, missing.body.message);
  const unverified = await send("sign-in/email", { email, password });
  assert.equal(unverified.response.status, 403);

  const resetExisting = await send("request-password-reset", {
    email,
    redirectTo: `${base}/?resetPassword=1`,
  });
  const resetRecord = await db
    .collection("verification")
    .findOne({ identifier: { $regex: "^reset-password:" } });

  assert.ok(resetRecord, "Reset request must create a token");

  const lifetime =
    (Number(resetRecord.expiresAt) - Number(resetRecord.createdAt)) / 1000;

  assert.ok(
    lifetime >= 899 && lifetime <= 901,
    `Expected 15-minute reset expiry, got ${lifetime}s`,
  );

  await db
    .collection("verification")
    .updateOne(
      { _id: resetRecord._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

  const expiredReset = await send("reset-password", {
    token: resetRecord.identifier.slice("reset-password:".length),
    newPassword: password,
  });

  assert.equal(expiredReset.response.status, 400);
  assert.equal(expiredReset.body.code, "INVALID_TOKEN");

  const resetMissing = await send("request-password-reset", {
    email: `missing-${suffix}@example.test`,
    redirectTo: `${base}/?resetPassword=1`,
  });

  assert.equal(resetExisting.response.status, 200);
  assert.deepEqual(resetMissing.body, resetExisting.body);

  const unsafe = await send("request-password-reset", {
    email,
    redirectTo: "https://evil.example/reset",
  });

  assert.equal(unsafe.response.status, 403);

  const csrf = await auth.handler(
    new Request(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "x-zetafly-client-ip": "198.51.100.2",
      },
      body: JSON.stringify({ email, password }),
    }),
  );

  assert.equal(csrf.status, 403);

  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await send(
      "sign-in/email",
      { email: `missing-${suffix}@example.test`, password },
      "198.51.100.1",
    );

    assert.equal(result.response.status, attempt === 5 ? 429 : 401);
  }

  await db
    .collection("user")
    .updateOne({ _id: user._id }, { $set: { emailVerified: true } });
  const firstLogin = await send("sign-in/email", { email, password });
  const secondLogin = await send("sign-in/email", { email, password });
  assert.equal(firstLogin.response.status, 200);
  assert.equal(secondLogin.response.status, 200);
  const cookies = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  const currentCookie = cookies(firstLogin.response);
  const otherCookie = cookies(secondLogin.response);
  const nextPassword = randomBytes(24).toString("base64url");
  const invalidChange = await send(
    "change-password",
    {
      currentPassword: "incorrect-password",
      newPassword: nextPassword,
      revokeOtherSessions: true,
    },
    undefined,
    currentCookie,
  );
  assert.equal(invalidChange.response.status, 400);
  assert.ok(
    await auth.api.getSession({
      headers: new Headers({ Cookie: otherCookie }),
    }),
  );
  const changed = await send(
    "change-password",
    {
      currentPassword: password,
      newPassword: nextPassword,
      revokeOtherSessions: true,
    },
    undefined,
    currentCookie,
  );
  assert.equal(changed.response.status, 200);
  for (const cookie of [currentCookie, otherCookie]) {
    assert.equal(
      await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) }),
      null,
    );
  }
  assert.ok(
    await auth.api.getSession({
      headers: new Headers({ Cookie: cookies(changed.response) }),
    }),
  );
  assert.equal(
    (await send("sign-in/email", { email, password })).response.status,
    401,
  );
  assert.equal(
    (await send("sign-in/email", { email, password: nextPassword })).response
      .status,
    200,
  );

  console.log(
    "Authentication security passed, including password change and session revocation",
  );
} finally {
  globalThis.fetch = originalFetch;
  await db.dropDatabase();
  await client.close();
}

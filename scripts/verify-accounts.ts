import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import type { SessionPacket, Settings } from "../shared/contracts.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";
import type {
  AccountResponse,
  MailMessage,
  MailSearch,
  Profile,
  RequestOptions,
  Run,
} from "./verification-types.ts";

const base = process.env.APP_URL ?? "http://localhost:3000";
const suffix = randomBytes(6).toString("hex");
const password = randomBytes(24).toString("base64url");

function client() {
  const cookies = new Map<string, string>();

  return {
    cookies,
    cookie: () =>
      [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    async send(
      path: string,
      { method = "GET", json, body, headers = {} }: RequestOptions = {},
    ) {
      const response = await fetch(base + path, {
        method,
        redirect: "manual",
        headers: {
          Origin: base,
          Cookie: this.cookie(),
          ...(json ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: json ? JSON.stringify(json) : body,
      });

      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";")[0];
        const index = pair.indexOf("=");
        const key = pair.slice(0, index);
        const content = pair.slice(index + 1);

        if (content) {
          cookies.set(key, content);
        } else {
          cookies.delete(key);
        }
      }

      return response;
    },
  };
}

async function json<T = AccountResponse>(response: Response, status = 200) {
  assert.equal(response.status, status, "Unexpected HTTP response status");

  return response.json() as Promise<T>;
}

async function emailLink(email: string, subject: string) {
  const mailbox = process.env.MAILPIT_URL ?? "http://localhost:8025";

  for (let attempt = 0; attempt < 20; attempt++) {
    const found = (await (
      await fetch(
        `${mailbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      )
    ).json()) as MailSearch;
    const summary = found.messages?.find(
      (message) => message.Subject === subject,
    );

    if (summary) {
      const message = (await (
        await fetch(`${mailbox}/api/v1/message/${summary.ID}`)
      ).json()) as MailMessage;
      const link = message.Text.match(/https?:\/\/[^\s]+/)?.[0];
      assert.ok(link);

      return new URL(link);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw Error("Account email did not reach the local inbox");
}

async function signup(instance: ReturnType<typeof client>, label: string) {
  const email = `zetafly-${label}-${suffix}@example.test`;
  const result = await json(
    await instance.send("/api/auth/sign-up/email", {
      method: "POST",
      json: { name: `QA ${label}`, email, password, callbackURL: `${base}/` },
    }),
  );

  await json(await instance.send("/api/access", { method: "POST" }), 401);

  if (label === "A") {
    await json(
      await instance.send("/api/auth/sign-in/email", {
        method: "POST",
        json: { email, password },
      }),
      403,
    );
  }

  const link = await emailLink(email, "Verify your Zetafly email");
  const verified = await instance.send(link.pathname + link.search);
  assert.equal(verified.status, 302);
  await json(await instance.send("/api/access", { method: "POST" }));

  return { email, user: result.user };
}

if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw Error("Run this fixture against a local app");
}

const publicConfig = await (await fetch(`${base}/api/public-config`)).json();

assert.ok(publicConfig.localInbox, "Use local Mailpit for this fixture");

const a = client();
const b = client();

await json<Settings>(await a.send("/api/preferences"), 401);

const alice = await signup(a, "A");

await signup(b, "B");

const token = decodeURIComponent(a.cookies.get("zetafly_access")!);
const [headerPart, payloadPart] = token.split(".");
const header = JSON.parse(
  Buffer.from(headerPart, "base64url").toString("utf8"),
) as { alg: string };
const payload = JSON.parse(
  Buffer.from(payloadPart, "base64url").toString("utf8"),
) as { aud: string; sub: string; exp: number; iat: number; sid: string };

assert.equal(header.alg, "EdDSA");

assert.equal(payload.aud, "zetafly-api");

assert.equal(payload.sub, alice.user.id);

assert.ok(payload.exp > payload.iat && payload.exp - payload.iat <= 900);

assert.ok(payload.sid);

const headers = { Authorization: `Bearer ${token}` };

assert.equal((await fetch(`${base}/api/preferences`, { headers })).status, 200);

const forged = `${token.slice(0, -8)}AAAAAAAA`;

assert.equal(
  (
    await fetch(`${base}/api/preferences`, {
      headers: { Authorization: `Bearer ${forged}` },
    })
  ).status,
  401,
);

const jwt = a.cookies.get("zetafly_access")!;

a.cookies.delete("zetafly_access");

await json<Settings>(await a.send("/api/preferences"), 401);

a.cookies.set("zetafly_access", jwt);

const defaults = await json<Settings>(await a.send("/api/preferences"));

assert.deepEqual(defaults, DEFAULT_SETTINGS);

await json<Settings>(
  await a.send("/api/preferences", {
    method: "PUT",
    json: { ...defaults, duration: 300 },
  }),
);

assert.equal(
  (await json<Settings>(await a.send("/api/preferences"))).duration,
  300,
);

assert.equal(
  (await json<Settings>(await b.send("/api/preferences"))).duration,
  120,
);

await json(
  await a.send("/api/weights", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": "broken.npz",
    },
    body: Buffer.from("not a checkpoint"),
  }),
  400,
);

const fixture = await readFile("models/default/weights.npz");
const profile = await json<Profile>(
  await a.send("/api/weights", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": "Uploaded-default-QA.npz",
    },
    body: fixture,
  }),
  201,
);

assert.equal(profile.synaptic, true);

const downloaded = await a.send(`/api/weights/${profile.id}/file`);

assert.equal(downloaded.status, 200);

assert.match(downloaded.headers.get("content-disposition") ?? "", /\.npz/);

assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), fixture);

const defaultDownload = await a.send("/api/weights/published/file");

assert.equal(defaultDownload.status, 200);

assert.match(defaultDownload.headers.get("content-disposition") ?? "", /\.npz/);

assert.deepEqual(Buffer.from(await defaultDownload.arrayBuffer()), fixture);

assert.ok(
  (await json<Profile[]>(await a.send("/api/weights"))).some(
    (row) => row.id === profile.id,
  ),
);

assert.ok(
  !(await json<Profile[]>(await b.send("/api/weights"))).some(
    (row) => row.id === profile.id,
  ),
);

await json(await b.send(`/api/weights/${profile.id}/file`), 404);

await json<Settings>(
  await b.send("/api/preferences", {
    method: "PUT",
    json: { ...defaults, profileId: profile.id },
  }),
  404,
);

await json<Settings>(
  await a.send("/api/preferences", {
    method: "PUT",
    json: { ...defaults, duration: 300, profileId: profile.id },
  }),
);

const messagesA: SessionPacket[] = [];
const messagesB: SessionPacket[] = [];

function connect(
  instance: ReturnType<typeof client>,
  messages: SessionPacket[],
) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`${base.replace("http", "ws")}/live`, {
      origin: base,
      headers: { Cookie: instance.cookie() },
    });

    socket.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as SessionPacket);

      if (messages.length === 1) {
        resolve(socket);
      }
    });

    socket.on("error", reject);
  });
}

const socketA = await connect(a, messagesA);
const socketB = await connect(b, messagesB);
let closed = false;

socketA.on("close", () => {
  closed = true;
});

const settings = {
  ...defaults,
  sub: false,
  mul: false,
  div: false,
  add_left_min: 4,
  add_left_max: 4,
  add_right_min: 3,
  add_right_max: 3,
  duration: 30,
};

async function run(profileId: string) {
  const previous = (await json<Run[]>(await a.send("/api/runs")))[0]?.id;
  const packetOffset = messagesA.length;

  await json(
    await a.send("/api/start", {
      method: "POST",
      json: { ...settings, profileId },
    }),
    202,
  );

  await json(await b.send("/api/preview", { method: "POST" }), 409);

  for (let count = 0; count < 100; count++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const latest = (await json<Run[]>(await a.send("/api/runs")))[0];

    if (latest && latest.id !== previous) {
      assert.equal(latest.status, "completed", latest.error);
      const packets = messagesA.slice(packetOffset);
      const loading = packets.findIndex(
        (packet) => packet.kind === "state" && packet.status === "loading",
      );
      const running = packets.findIndex(
        (packet) => packet.kind === "state" && packet.status === "running",
      );

      assert.ok(loading >= 0 && running > loading);

      const setup = packets
        .slice(loading + 1, running)
        .filter((packet) => packet.kind === "screen");

      assert.ok(
        setup.length >= 2,
        "Setup and first problem must both be captured before typing",
      );

      assert.notEqual(
        setup[0].png,
        setup.at(-1)!.png,
        "Setup must not reuse the old game screen",
      );

      const began = packets[running];
      const ended = packets.findLast(
        (packet) => packet.kind === "state" && packet.status === "completed",
      );

      assert.ok(began.kind === "state" && ended?.kind === "state");
      const elapsed = ended.endedAt! - began.serverTime!;

      assert.ok(
        elapsed >= 29000 && elapsed < 40000,
        `A 30-second game ran for ${elapsed} ms`,
      );

      const run = await json<Run>(await a.send(`/api/runs/${latest.id}`));
      const contacts = new Map<
        number,
        Extract<Run["events"][number], { kind: "motor" }>
      >();
      let keys = 0;

      for (const event of run.events) {
        if (event.kind === "motor" && event.phase === "contact") {
          contacts.set(event.contactId!, event);
        }

        if (event.kind === "input") {
          const contact = contacts.get(event.contactId);
          assert.ok(contact);
          assert.equal(contact.key, event.key);
          assert.equal(event.trusted, true);
          assert.deepEqual(contact.effector, event.position);
          keys++;
        }
      }

      assert.ok(keys > 0);
      assert.equal(
        run.attempts,
        run.events.filter((event) => event.kind === "attempt").length,
      );
      assert.equal(
        run.accepted,
        run.events.filter((event) => event.kind === "attempt" && event.accepted)
          .length,
      );

      return run;
    }
  }

  throw Error("Run did not finish");
}

const custom = await run(profile.id);
const customPrediction = custom.events.find(
  (event) => event.kind === "prediction",
)!;

assert.equal(custom.profile.id, profile.id);

assert.equal(custom.profile.sha256, profile.sha256);

assert.ok(customPrediction.neural?.rates?.length);

assert.ok(Number.isSafeInteger(customPrediction.answer));

await json(await b.send(`/api/runs/${custom.id}`), 404);

const builtin = await run("published");
const builtinPrediction = builtin.events.find(
  (event) => event.kind === "prediction",
)!;

assert.ok(builtinPrediction.neural?.rates?.length);

assert.equal(builtinPrediction.answer, customPrediction.answer);

assert.equal(
  messagesB.length,
  1,
  "Another account received private live events",
);

assert.ok(messagesA.some((event) => event.kind === "activity"));

await json(await a.send("/api/auth/sign-out", { method: "POST" }));

assert.equal(
  (await fetch(`${base}/api/preferences`, { headers })).status,
  401,
  "Logged-out JWT still works",
);

await new Promise((resolve) => setTimeout(resolve, 100));

assert.equal(closed, true, "Logged-out live stream stayed open");

await json(
  await a.send("/api/auth/sign-in/email", {
    method: "POST",
    json: { email: alice.email, password: "incorrect-password" },
  }),
  401,
);

await json(
  await a.send("/api/auth/sign-in/email", {
    method: "POST",
    json: { email: alice.email, password },
  }),
);

await json(await a.send("/api/access", { method: "POST" }));

assert.equal(
  (await json<Settings>(await a.send("/api/preferences"))).profileId,
  profile.id,
);

const beforeReset = decodeURIComponent(a.cookies.get("zetafly_access")!);

await json(
  await a.send("/api/auth/request-password-reset", {
    method: "POST",
    json: { email: alice.email, redirectTo: `${base}/?resetPassword=1` },
  }),
);

const resetLink = await emailLink(alice.email, "Reset your Zetafly password");
const redirect = await a.send(resetLink.pathname + resetLink.search);

assert.equal(redirect.status, 302);

const resetToken = new URL(redirect.headers.get("location")!).searchParams.get(
  "token",
);

assert.ok(resetToken);

const newPassword = randomBytes(24).toString("base64url");

await json(
  await a.send("/api/auth/reset-password", {
    method: "POST",
    json: { token: resetToken, newPassword },
  }),
);

assert.equal(
  (
    await fetch(`${base}/api/preferences`, {
      headers: { Authorization: `Bearer ${beforeReset}` },
    })
  ).status,
  401,
);

await json(
  await a.send("/api/auth/reset-password", {
    method: "POST",
    json: { token: resetToken, newPassword },
  }),
  400,
);

await json(
  await a.send("/api/auth/sign-in/email", {
    method: "POST",
    json: { email: alice.email, password },
  }),
  401,
);

await json(
  await a.send("/api/auth/sign-in/email", {
    method: "POST",
    json: { email: alice.email, password: newPassword },
  }),
);

await json(await a.send("/api/access", { method: "POST" }));

socketB.close();

console.log("Account and model integration passed");

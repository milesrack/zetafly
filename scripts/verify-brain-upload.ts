import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { chromium, request } from "playwright";
import { sha256 } from "../server/brain/graph.ts";
import { ZETAMAC_SETTINGS } from "../shared/settings.ts";
import type {
  MailMessage,
  MailSearch,
  Profile,
  Run,
} from "./verification-types.ts";

const { values } = parseArgs({ options: { model: { type: "string" } } });
if (!values.model) {
  throw Error("Use --model weights.npz");
}
const base = process.env.APP_URL ?? "http://localhost:3000";
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
const bytes = await readFile(values.model);
const password = randomBytes(24).toString("base64url");
const email = `brain-${randomBytes(6).toString("hex")}@example.test`;
const api = await request.newContext({
  baseURL: base,
  extraHTTPHeaders: { Origin: base },
});
const config = await (await api.get("/api/public-config")).json();
assert.ok(config.localInbox, "Verification requires the local test inbox");
const browser = await chromium.launch();
let accountCreated = false;
let profile: Profile | undefined;

async function waitFor(
  check: () => Promise<boolean>,
  message: string,
  timeout = 30000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(message);
}

try {
  const signup = await api.post("/api/auth/sign-up/email", {
    data: {
      name: "Brain upload verification",
      email,
      password,
      callbackURL: `${base}/`,
    },
  });
  assert.equal(signup.status(), 200);
  accountCreated = true;
  let link: URL | undefined;
  const inbox = process.env.MAILPIT_URL ?? "http://localhost:8025";
  await waitFor(async () => {
    const search = (await (
      await fetch(
        `${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      )
    ).json()) as MailSearch;
    const message = search.messages?.find(
      (row) => row.Subject === "Verify your Zetafly email",
    );
    if (!message) {
      return false;
    }
    const body = (await (
      await fetch(`${inbox}/api/v1/message/${message.ID}`)
    ).json()) as MailMessage;
    link = new URL(body.Text.match(/https?:\/\/[^\s]+/)![0]);
    return true;
  }, "Verification message did not arrive");
  assert.equal(link!.origin, base);
  assert.equal(
    (
      await api.get(link!.pathname + link!.search, { maxRedirects: 0 })
    ).status(),
    302,
  );
  assert.equal(
    (
      await api.post("/api/auth/sign-in/email", { data: { email, password } })
    ).status(),
    200,
  );
  assert.equal((await api.post("/api/access")).status(), 200);
  const context = await browser.newContext({
    storageState: await api.storageState(),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  let accepted = 0;
  let activity = false;
  let runError: string | undefined;
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const packet = JSON.parse(String(payload));
      if (packet.kind === "attempt" && packet.accepted) {
        accepted = packet.score;
      }
      if (packet.kind === "activity" && packet.neural?.rates?.length) {
        activity = true;
      }
      if (packet.kind === "state" && packet.error) {
        runError = packet.error;
      }
    }),
  );
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const upload = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/weights" &&
      response.request().method() === "POST",
  );
  await page
    .getByLabel("Weights file", { exact: true })
    .setInputFiles(values.model);
  const response = await upload;
  assert.equal(response.status(), 201);
  profile = ((await (await api.get("/api/weights")).json()) as Profile[]).find(
    (row) => row.id !== "published" && row.sha256 === sha256(bytes),
  );
  assert.ok(profile);
  console.log("Brain upload accepted through Settings");
  assert.equal(profile.sha256, sha256(bytes));
  await waitFor(
    async () =>
      (await (await api.get("/api/preferences")).json()).profileId ===
      profile!.id,
    "Uploaded weights selection was not persisted",
  );
  const profiles = (await (await api.get("/api/weights")).json()) as Profile[];
  assert.ok(profiles.some((row) => row.id === profile!.id));
  const download = await api.get(`/api/weights/${profile.id}/file`);
  assert.equal(download.status(), 200);
  assert.equal(sha256(await download.body()), sha256(bytes));
  assert.equal(
    (
      await api.put("/api/preferences", {
        data: { ...ZETAMAC_SETTINGS, mul_left_max: 100, profileId: profile.id },
      })
    ).status(),
    200,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    (
      await page.getByRole("combobox", { name: "Weight profile" }).innerText()
    ).trim(),
    profile.name,
  );
  await page.getByRole("button", { name: "Close settings" }).click();
  console.log("Brain selection survived reload; starting session");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await waitFor(
    async () => {
      assert.equal(runError, undefined);
      return accepted >= 5 && activity;
    },
    "Uploaded weights did not solve five problems with neural activity",
    60000,
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  const runs = (await (await api.get("/api/runs")).json()) as Run[];
  assert.ok(runs.length);
  assert.equal(runs[0].profile.id, profile.id);
  assert.ok(runs[0].accepted >= 5);
  const run = (await (await api.get(`/api/runs/${runs[0].id}`)).json()) as Run;
  assert.ok(
    run.events.some((event) => event.kind === "input" && event.trusted),
  );
  assert.equal((await api.delete(`/api/weights/${profile.id}`)).status(), 200);
  profile = undefined;
  assert.equal(
    (await (await api.get("/api/preferences")).json()).profileId,
    "published",
  );
  console.log(
    JSON.stringify({
      uploaded: true,
      selectedAfterReload: true,
      downloadHashMatched: true,
      accepted: runs[0].accepted,
      neuralActivity: activity,
      removalResetSelection: true,
    }),
  );
} finally {
  try {
    if (accountCreated) {
      await api.post("/api/stop");
      if (profile) {
        await api.delete(`/api/weights/${profile.id}`);
      }
      const deleted = await api.post("/api/auth/delete-user", {
        data: { password },
      });
      assert.equal(
        deleted.status(),
        200,
        "Could not remove the verification account",
      );
    }
  } finally {
    await browser.close();
    await api.dispose();
  }
}

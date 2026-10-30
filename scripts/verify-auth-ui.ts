import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page, type WebSocketRoute, webkit } from "playwright";
import { DEFAULTS } from "../server/settings.ts";

async function accessibility(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  assert.deepEqual(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
    [],
    "No automated WCAG violations expected in this UI state",
  );
}

const base = process.env.APP_URL ?? "http://localhost:3000";
const user = {
  id: "ui-test",
  name: "UI Test",
  email: "ui@example.test",
  emailVerified: true,
};

async function mock(
  page: Page,
  signedIn = false,
  connect: (socket: WebSocketRoute) => void = () => {},
) {
  let releaseReset = () => {};
  let resetStarted = false;

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};

    if (path === "/api/auth/get-session") {
      json = signedIn
        ? {
            user,
            session: {
              id: "test",
              userId: user.id,
              token: "test",
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            },
          }
        : null;
    } else if (path === "/api/preferences") {
      json = DEFAULTS;
    } else if (path === "/api/weights") {
      json = [{ id: "published", name: "Default", arithmeticMode: "sequence" }];
    } else if (path === "/api/auth/sign-up/email") {
      json = { user: { ...user, emailVerified: false }, token: null };
    } else if (path === "/api/auth/sign-in/email") {
      await route.fulfill({
        status: 403,
        json: { code: "EMAIL_NOT_VERIFIED", message: "Verify your email" },
      });

      return;
    } else if (path === "/api/auth/request-password-reset") {
      resetStarted = true;

      await new Promise<void>((resolve) => {
        releaseReset = resolve;
      });

      json = { status: true, message: "Reset email sent" };
    }

    await route.fulfill({ json });
  });

  await page.routeWebSocket("**/live", connect);

  return {
    releaseReset: () => releaseReset(),
    resetStarted: () => resetStarted,
  };
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();

  try {
    const failurePage = await browser.newPage();
    failurePage.setDefaultTimeout(30000);
    const failed = {
      kind: "state",
      runId: "old-run",
      status: "failed",
      keys: [],
      frame: null,
      trial: null,
      attempts: 0,
      accepted: 0,
      error: "Model emitted an empty or invalid answer",
    };
    let send = (_packet: object) => {};

    await mock(failurePage, true, (socket) => {
      send = (packet) => socket.send(JSON.stringify(packet));
      send(failed);
    });

    const waitForStatus = (status: string) =>
      failurePage.waitForFunction(
        (status) =>
          document
            .querySelector(".sr-only[role=status]")
            ?.textContent?.includes(`Run ${status}.`),
        status,
      );

    await failurePage.goto(base);
    await waitForStatus("failed");

    assert.equal(
      await failurePage.locator(".error-toast").count(),
      0,
      "refresh must not announce an already failed run as a new error",
    );

    send({ ...failed, runId: "new-run", status: "running", error: null });
    await waitForStatus("running");
    send({ ...failed, runId: "new-run" });
    await failurePage.locator(".error-toast").waitFor();

    assert.match(
      await failurePage.locator(".error-toast").innerText(),
      /The model did not produce a valid answer/,
    );

    await failurePage.getByRole("button", { name: "Dismiss error" }).click();
    send({ ...failed, runId: "new-run" });
    await waitForStatus("failed");

    assert.equal(
      await failurePage.locator(".error-toast").count(),
      0,
      "duplicate terminal snapshots must not redisplay a dismissed error",
    );

    await failurePage.reload();
    await waitForStatus("failed");
    assert.equal(await failurePage.locator(".error-toast").count(), 0);
    await failurePage.close();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.clock.install();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mock(page, true);
    let writes = 0;
    let persisted = DEFAULTS;
    let releaseFirst = () => {};

    await page.route("**/api/preferences", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: DEFAULTS });
      }

      const settings = route.request().postDataJSON();

      if (++writes === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }

      persisted = settings;
      await route.fulfill({ json: settings });
    });

    await page.goto(base);

    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => {} },
      }),
    );

    const badge = page.getByRole("button", { name: "Account", exact: true });
    await badge.click();
    await accessibility(page);
    await page.locator(".account-email-row").hover();
    await page.clock.pauseAt(new Date(Date.now() + 60000));
    const copy = page.locator(".copy-email");
    await copy.click();

    await page
      .getByRole("button", { name: "Email copied", exact: true })
      .waitFor();

    await page.clock.fastForward(1000);
    await copy.click();
    await page.clock.fastForward(1100);

    assert.ok(
      await page
        .getByRole("button", { name: "Email copied", exact: true })
        .isVisible(),
    );

    await page.clock.fastForward(1000);

    await page
      .getByRole("button", { name: "Copy email", exact: true })
      .waitFor();

    await page.clock.resume();

    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error("Permission denied");
          },
        },
      }),
    );

    await page.getByRole("button", { name: "Copy email", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await page.keyboard.press("Escape");
    await badge.click();
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await page.locator(".account-menu:popover-open").count(), 0);
    await accessibility(page);

    await page
      .getByLabel("Weights file")
      .dispatchEvent("cancel", { bubbles: true });

    assert.equal(
      await page
        .getByRole("dialog", { name: "Settings", exact: true })
        .isVisible(),
      true,
      "cancelling the native file picker must leave Settings open",
    );

    const downloading = page.waitForEvent("download");

    await page
      .getByRole("button", { name: "Download default", exact: true })
      .click();

    assert.equal(
      (await downloading).suggestedFilename(),
      "zetafly-default.npz",
    );

    await page.getByRole("combobox", { name: "Duration" }).click();
    await page.getByRole("option", { name: "1 minute", exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(writes, 1, "preference writes must not overlap");

    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/preferences") &&
        response.request().method() === "PUT" &&
        response.request().postDataJSON().duration === 60,
    );

    releaseFirst();
    await saved;

    assert.equal(
      persisted.duration,
      60,
      "newest settings must persist after an older delayed save",
    );

    await page.getByRole("combobox", { name: "Weight profile" }).click();
    await page.getByPlaceholder("Search weights…").fill("no match");
    await page.keyboard.press("Escape");

    assert.ok(
      await page
        .getByRole("dialog", { name: "Settings", exact: true })
        .isVisible(),
    );

    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);

    let passwordChanges = 0;
    let finishPasswordChange = () => {};
    await page.route("**/api/auth/change-password", async (route) => {
      passwordChanges++;
      const body = route.request().postDataJSON();
      assert.equal(body.newPassword, "Jade!Harbour9-Saturn2-copper");
      assert.equal(body.revokeOtherSessions, true);

      if (passwordChanges === 1) {
        await route.fulfill({
          status: 400,
          json: { message: "Invalid password" },
        });
        return;
      }

      assert.equal(body.currentPassword, "correct-password");
      await new Promise<void>((resolve) => {
        finishPasswordChange = resolve;
      });
      await route.fulfill({ json: { token: "new-session", user } });
    });

    await badge.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    const changing = page.getByRole("dialog", {
      name: "Change password",
      exact: true,
    });
    await accessibility(page);
    await changing
      .getByLabel("Current password", { exact: true })
      .fill("incorrect-password");
    await changing
      .getByLabel("New password", { exact: true })
      .fill("Jade!Harbour9-Saturn2-copper");
    await changing
      .getByLabel("Confirm new password", { exact: true })
      .fill("different-password");
    await changing
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await changing.getByRole("alert").waitFor();
    assert.match(await changing.getByRole("alert").innerText(), /do not match/);
    assert.equal(passwordChanges, 0);
    await changing
      .getByLabel("Confirm new password", { exact: true })
      .fill("Jade!Harbour9-Saturn2-copper");
    await changing
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await changing.getByRole("alert").waitFor();
    assert.match(
      await changing.getByRole("alert").innerText(),
      /Invalid password/,
    );
    await changing
      .getByLabel("Current password", { exact: true })
      .fill("correct-password");
    const renewed = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/access") && request.method() === "POST",
    );
    await changing
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await changing
      .getByRole("button", { name: "Changing password…" })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.ok(await changing.isVisible());
    finishPasswordChange();
    await changing.getByRole("status").waitFor();
    await renewed;
    await accessibility(page);
    await changing.getByRole("button", { name: "Done", exact: true }).click();
    await badge.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    for (const name of [
      "Current password",
      "New password",
      "Confirm new password",
    ]) {
      assert.equal(
        await changing.getByLabel(name, { exact: true }).inputValue(),
        "",
      );
    }
    await changing.getByRole("button", { name: "Cancel", exact: true }).click();

    let deletionAttempts = 0;
    let finishDeletion = () => {};
    await page.route("**/api/auth/delete-user", async (route) => {
      deletionAttempts++;

      if (deletionAttempts === 1) {
        await route.fulfill({
          status: 400,
          json: { code: "INVALID_PASSWORD", message: "Invalid password" },
        });

        return;
      }

      await new Promise<void>((resolve) => {
        finishDeletion = resolve;
      });

      await route.fulfill({
        json: { success: true, message: "User deleted" },
      });
    });

    await badge.click();
    assert.equal(
      await page
        .getByRole("button", { name: "Delete account", exact: true })
        .count(),
      0,
      "Account deletion belongs in Settings, not the account menu",
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    const deleting = page.getByRole("dialog", {
      name: "Delete account",
      exact: true,
    });
    const deletePassword = deleting.getByLabel("Current password", {
      exact: true,
    });
    const confirmation = deleting.getByRole("checkbox");
    const deleteButton = deleting.getByRole("button", {
      name: "Delete account permanently",
    });
    await accessibility(page);
    await deletePassword.fill("incorrect-password");
    await deleteButton.click();
    assert.equal(
      deletionAttempts,
      0,
      "Deletion requires explicit acknowledgement",
    );
    await confirmation.check();
    await deleteButton.click();
    await deleting.getByRole("alert").waitFor();
    assert.match(
      await deleting.getByRole("alert").innerText(),
      /Invalid password/,
    );
    await deleting.getByRole("button", { name: "Cancel", exact: true }).click();
    await badge.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    assert.equal(await deletePassword.inputValue(), "");
    assert.equal(await confirmation.isChecked(), false);
    assert.equal(await deleting.getByRole("alert").count(), 0);
    await deletePassword.fill("correct-password");
    await confirmation.check();
    await deleteButton.click();
    await deleting.getByRole("button", { name: "Deleting account…" }).waitFor();
    await page.keyboard.press("Escape");
    assert.ok(
      await deleting.isVisible(),
      "Pending deletion cannot be dismissed",
    );
    assert.ok(
      await deleting
        .getByRole("button", { name: "Cancel", exact: true })
        .isDisabled(),
    );
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({ json: null }),
    );
    finishDeletion();
    await page
      .locator("header")
      .getByRole("button", { name: "Log in", exact: true })
      .waitFor();
    assert.equal(await deleting.count(), 0);
    await page.close();

    const guestContext = await browser.newContext();
    guestContext.setDefaultTimeout(30000);
    const guest = await guestContext.newPage();
    guest.on("pageerror", (error) => errors.push(error.message));
    const requests = await mock(guest);
    await guest.goto(base);

    const login = guest
      .locator("header")
      .getByRole("button", { name: "Log in", exact: true });
    const close = guest.getByRole("button", { name: "Close account" });
    const dialog = guest.locator("dialog[open]");
    await login.click();
    await accessibility(guest);
    await guest.getByLabel("Email", { exact: true }).fill(user.email);

    await guest
      .getByLabel("Password", { exact: true })
      .fill("temporary password");

    await guest.getByRole("button", { name: "Show password" }).click();
    await close.click();
    await login.click();

    assert.equal(
      await guest.getByLabel("Password", { exact: true }).inputValue(),
      "",
    );

    assert.equal(
      await guest.getByLabel("Password", { exact: true }).getAttribute("type"),
      "password",
    );

    await guest.getByRole("button", { name: "Forgot password?" }).click();

    assert.equal(
      await guest.getByLabel("Email", { exact: true }).inputValue(),
      user.email,
    );

    await close.click();
    await login.click();
    assert.equal(await dialog.getAttribute("aria-label"), "Log in");
    await guest.keyboard.press("Escape");
    assert.equal(await guest.locator("dialog[open]").count(), 0);
    await login.click();
    await guest.mouse.click(5, 5);
    assert.equal(await guest.locator("dialog[open]").count(), 0);
    await login.click();
    await guest.getByRole("button", { name: "Sign up", exact: true }).click();
    await accessibility(guest);
    await close.click();
    await guest.getByRole("button", { name: "Start", exact: true }).click();
    assert.equal(await dialog.getAttribute("aria-label"), "Log in");
    await guest.getByRole("button", { name: "Sign up", exact: true }).click();
    await guest.getByLabel("Name", { exact: true }).fill(user.name);

    await guest
      .getByLabel("Password", { exact: true })
      .fill("Jade!Harbour9-Saturn2-copper");

    await guest
      .getByRole("button", { name: "Create account", exact: true })
      .click();

    await guest
      .getByRole("dialog", { name: "Verify your email", exact: true })
      .waitFor();

    await accessibility(guest);

    assert.ok(
      await guest.getByRole("button", { name: /Resend in/ }).isDisabled(),
    );

    await close.click();
    await login.click();
    assert.equal(await dialog.getAttribute("aria-label"), "Log in");

    await guest
      .getByLabel("Password", { exact: true })
      .fill("temporary password");

    await dialog.getByRole("button", { name: "Log in", exact: true }).click();

    await guest
      .getByRole("dialog", { name: "Verify your email", exact: true })
      .waitFor();

    await guest
      .getByRole("button", { name: "Back to log in", exact: true })
      .click();

    assert.equal(
      await guest.getByLabel("Password", { exact: true }).inputValue(),
      "",
    );

    await guest.getByRole("button", { name: "Forgot password?" }).click();

    await guest
      .getByRole("button", { name: "Send reset link", exact: true })
      .click();

    for (let i = 0; i < 100 && !requests.resetStarted(); i++) {
      await guest.waitForTimeout(20);
    }

    assert.ok(requests.resetStarted());
    await close.click();
    await login.click();
    requests.releaseReset();
    await guest.waitForTimeout(300);

    assert.equal(
      await dialog.getAttribute("aria-label"),
      "Log in",
      "late reset response must not replace login",
    );

    for (const suffix of [
      "?resetPassword=1&token=test-token",
      "?resetPassword=1",
    ]) {
      await guest.goto(base + suffix);
      await guest.locator("dialog[open]").waitFor();

      assert.equal(
        await dialog.getAttribute("aria-label"),
        suffix.includes("token=") ? "New password" : "Reset password",
      );

      await accessibility(guest);

      if (suffix.includes("token=")) {
        await guest
          .getByLabel("Password", { exact: true })
          .fill("Jade!Harbour9-Saturn2-copper");

        await guest
          .getByRole("button", { name: "Save password", exact: true })
          .click();

        await guest
          .getByRole("dialog", { name: "Log in", exact: true })
          .waitFor();

        assert.equal(new URL(guest.url()).search, "");
      } else {
        assert.match(
          await dialog.getByRole("alert").innerText(),
          /invalid or expired/,
        );
      }

      await close.click();
      await login.click();
      assert.equal(await dialog.getAttribute("aria-label"), "Log in");
      assert.equal(await dialog.getByRole("alert").count(), 0);
    }

    assert.deepEqual(errors, []);

    console.log(
      `${engine.name()}: refreshed run errors, copy expiry/retry, menu errors, nested Escape, auth dismissal, password clearing, signup/verification, reset links, late responses and account deletion passed`,
    );
  } finally {
    await browser.close();
  }
}

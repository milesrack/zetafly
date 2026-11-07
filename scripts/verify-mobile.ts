import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Locator, type Page, webkit } from "playwright";
import { DEFAULTS } from "../server/settings.ts";

const base = process.env.APP_URL ?? "http://localhost:3000";
const evidence = process.env.MOBILE_SCREENSHOTS;

if (evidence) {
  await mkdir(evidence, { recursive: true });
}

async function targets(locator: Locator) {
  for (const element of await locator.all()) {
    if (!(await element.isVisible())) {
      continue;
    }

    const bounds = await element.boundingBox();
    assert.ok(
      bounds && bounds.width >= 44 && bounds.height >= 44,
      `${(await element.getAttribute("aria-label")) ?? (await element.innerText())} needs a 44px touch target`,
    );
  }
}

async function fits(page: Page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "The page must not overflow horizontally",
  );

  const surface = page.locator(
    "dialog[open], .account-menu:popover-open, .choice-menu",
  );

  for (const element of await surface.all()) {
    const bounds = await element.boundingBox();
    assert.ok(
      bounds &&
        bounds.x >= -1 &&
        bounds.x + bounds.width <= page.viewportSize()!.width + 1,
      "Dialogs and menus must fit the viewport",
    );
    assert.ok(
      await element.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Dialogs and menus must not clip horizontally",
    );
  }
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();

  try {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 844, height: 390 },
    ]) {
      const page = await browser.newPage({
        viewport,
        isMobile: true,
        hasTouch: true,
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const user = {
        id: "mobile",
        name: "Mobile Test",
        email: "mobile@example.test",
        emailVerified: true,
      };

      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json =
          path === "/api/auth/get-session"
            ? {
                user,
                session: {
                  id: "mobile",
                  userId: user.id,
                  token: "test",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                },
              }
            : path === "/api/preferences"
              ? route.request().method() === "GET"
                ? DEFAULTS
                : route.request().postDataJSON()
              : path === "/api/weights"
                ? [
                    {
                      id: "published",
                      name: "Default",
                      arithmeticMode: "sequence",
                    },
                  ]
                : {};
        await route.fulfill({ json });
      });
      await page.routeWebSocket("**/live", (socket) => {
        const startedAt = Date.now() - 10000;
        socket.send(
          JSON.stringify({
            kind: "state",
            runId: "mobile",
            status: "completed",
            startedAt,
            endedAt: Date.now(),
            serverTime: Date.now(),
            keys: [],
            frame: null,
            trial: null,
            attempts: 1,
            accepted: 0,
            settings: DEFAULTS,
          }),
        );
        socket.send(
          JSON.stringify({
            kind: "activity",
            neural: {
              spikes: [[1, 10]],
              inputs: [1],
              population: 3,
              totalSpikes: 1,
              durationMs: 250,
            },
            timing: {
              observationId: "mobile",
              startedAt: startedAt + 1000,
              recordedAt: startedAt + 2000,
              through: 250,
            },
          }),
        );
      });
      const capture = async (name: string) => {
        if (evidence) {
          await page.screenshot({
            path: `${evidence}/${engine.name()}-${viewport.width}-${name}.png`,
          });
        }
      };
      await page.goto(base);
      assert.equal(await page.title(), "Zetafly");
      await page
        .getByRole("button", { name: "Account", exact: true })
        .waitFor();
      await targets(
        page.locator("header button, .view-controls button, .sound-button"),
      );
      await fits(page);

      for (const name of ["Keyboard", "Screen", "Brain", "Desk"]) {
        const tab = page.getByRole("tab", { name, exact: true });
        await tab.click();
        assert.equal(await tab.getAttribute("aria-selected"), "true");
      }
      await page.getByRole("tab", { name: "Brain", exact: true }).click();
      await page.getByRole("button", { name: "Neural activity" }).click();
      await page.locator(".spike-panel").waitFor();
      await targets(page.locator(".activity-button"));
      await fits(page);
      await capture("brain");
      await page.getByRole("button", { name: "Neural activity" }).click();
      await page.getByRole("slider", { name: "Run playback time" }).tap();
      await targets(page.locator(".timeline-transport button, .timeline-seek"));
      await page.getByRole("combobox", { name: "Playback speed" }).click();
      await targets(page.getByRole("option"));
      await page.getByRole("option", { name: "0.5×", exact: true }).click();
      assert.equal(
        await page
          .getByRole("combobox", { name: "Playback speed" })
          .innerText(),
        "0.5×",
      );
      assert.ok(
        await page
          .locator(".brain-timeline .choice-trigger > span:first-child")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
        "Playback speed must remain readable without truncation",
      );
      const timeline = await page.locator(".brain-timeline").boundingBox();
      const views = await page.locator(".view-switcher").boundingBox();
      assert.ok(
        timeline && views && timeline.y + timeline.height <= views.y,
        "Playback and view controls must not overlap",
      );
      await capture("playback");

      const settings = async () => {
        await page
          .getByRole("button", { name: "Account", exact: true })
          .click();
        await targets(page.locator(".account-menu button"));
        await fits(page);
        await capture("account-menu");
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
      };
      await settings();
      await targets(
        page.locator(
          ".inspector button, .operation-options label, .sound-settings label",
        ),
      );
      for (const input of await page.locator(".range-row input").all()) {
        assert.equal(
          await input.evaluate((e) => getComputedStyle(e).fontSize),
          "16px",
        );
      }
      await fits(page);
      await capture("settings");
      await page.getByRole("combobox", { name: "Weight profile" }).click();
      await page
        .getByRole("combobox", { name: "Search weights" })
        .fill("Default");
      await page.getByRole("option", { name: "Default" }).waitFor();
      await targets(page.getByRole("option"));
      await fits(page);
      await capture("weight-search");
      await page.getByRole("option", { name: "Default" }).click();
      await page
        .getByRole("combobox", { name: "Duration", exact: true })
        .click();
      await targets(page.getByRole("option"));
      await page
        .getByRole("option", { name: "2 minutes", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("combobox", { name: "Duration", exact: true })
          .innerText(),
        "2 minutes",
      );
      const addition = page.getByLabel("Addition", { exact: true });
      await addition.uncheck();
      assert.equal(await addition.isChecked(), false);
      const music = page.getByRole("switch", { name: "Background music" });
      await music.uncheck();
      assert.equal(await music.isChecked(), false);
      await page
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await fits(page);
      await targets(page.locator("dialog[open] button"));
      await capture("change-password");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await settings();
      await page
        .getByRole("button", { name: "Delete account", exact: true })
        .click();
      await fits(page);
      await capture("delete-account");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `${engine.name()} ${viewport.width}×${viewport.height}: views, playback, account menu, settings, search, choices, switches, and account dialogs passed`,
      );
    }
  } finally {
    await browser.close();
  }
}

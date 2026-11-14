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
                    },
                  ]
                : {};
        await route.fulfill({ json });
      });
      await page.route(/\/api\/runs\?/, async (route) => {
        const query = new URL(route.request().url()).searchParams.get("q");
        const runs = query
          ? []
          : [
              {
                id: "mobile-run",
                startedAt: "2026-11-09T12:00:00.000Z",
                profile: { name: "Default" },
                status: "completed",
                accepted: 12,
                attempts: 15,
              },
            ];
        await route.fulfill({
          headers: { "X-Total-Count": String(runs.length) },
          json: runs,
        });
      });
      await page.route("**/api/runs/mobile-run", (route) =>
        route.fulfill({
          json: {
            id: "mobile-run",
            startedAt: "2026-11-09T12:00:00.000Z",
            finishedAt: "2026-11-09T12:02:00.000Z",
            profile: { name: "Default" },
            status: "completed",
            accepted: 12,
            attempts: 15,
            events: [],
            settings: DEFAULTS,
          },
        }),
      );
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
      assert.ok(
        await page
          .locator(".view-controls")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
        "The view tabs must fit without squeezing their padding",
      );
      await page.getByRole("tab", { name: "Brain", exact: true }).click();
      await page.getByRole("button", { name: "Neural activity" }).click();
      await page.locator(".spike-panel").waitFor();
      await targets(page.locator(".activity-button"));
      await fits(page);
      await capture("brain");
      await page.getByRole("button", { name: "Neural activity" }).click();
      await page.getByRole("slider", { name: "Run playback time" }).tap();
      await targets(page.locator(".timeline-transport button, .timeline-seek"));
      if (viewport.width === 320) {
        await page.getByRole("combobox", { name: "Playback speed" }).click();
        await targets(page.getByRole("option"));
        await page.getByRole("option", { name: "0.5×", exact: true }).click();
        assert.equal(
          await page
            .getByRole("combobox", { name: "Playback speed" })
            .innerText(),
          "0.5×",
        );
      }
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
        assert.ok(
          await input.evaluate(
            (e) => parseFloat(getComputedStyle(e).fontSize) >= 16,
          ),
          "Editable fields must not trigger iPhone focus zoom",
        );
      }
      await fits(page);
      await capture("settings");
      if (viewport.width === 320) {
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
      }
      const closeSettings = page.getByRole("button", {
        name: "Close settings",
      });
      if (await closeSettings.isVisible()) {
        await closeSettings.click();
      }
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await page.getByRole("button", { name: "History", exact: true }).click();
      const history = page.getByRole("dialog", { name: "Run history" });
      const run = history.getByRole("button", {
        description: "Run ID mobile-run",
      });
      await run.getByText("12/15").waitFor();
      await run.getByText("Run mobile-r", { exact: true }).waitFor();
      await targets(history.getByRole("button"));
      await fits(page);
      await capture("history");
      await run.click();
      await history
        .locator(".run-detail-score")
        .getByText("12/15", { exact: false })
        .waitFor();
      await targets(history.getByRole("button"));
      await targets(history.getByRole("link", { name: "Export JSON" }));
      await fits(page);
      await capture("run-details");
      await history
        .getByRole("button", { name: "History", exact: true })
        .click();
      await run.waitFor();
      await history
        .getByRole("searchbox", { name: "Search runs" })
        .fill("missing");
      await history.getByText("No runs match your search.").waitFor();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `${engine.name()} ${viewport.width}×${viewport.height}: mobile layouts${viewport.width === 320 ? " and touch interactions" : ""} passed`,
      );
    }
  } finally {
    await browser.close();
  }
}

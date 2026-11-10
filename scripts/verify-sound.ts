import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { DEFAULTS } from "../server/settings.ts";

declare global {
  interface Window {
    __context: AudioContext;
    __sound: {
      attempts: number;
      duration: number;
      contexts: number;
      clicks: number;
      music: number;
      stops: number;
      offsets: number[];
      closed: number;
    };
  }
}

const base = process.env.APP_URL ?? "http://localhost:3000";

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.addInitScript(() => {
      const counters = {
        attempts: 0,
        duration: 0,
        contexts: 0,
        clicks: 0,
        music: 0,
        stops: 0,
        offsets: [] as number[],
        closed: 0,
      };

      window.__sound = counters;
      const Native = window.AudioContext;

      window.AudioContext = class extends Native {
        constructor(options?: AudioContextOptions) {
          super(options);
          counters.contexts++;
          window.__context = this;
        }

        resume() {
          counters.attempts++;

          return super.resume();
        }

        createBufferSource() {
          const source = super.createBufferSource();
          const start = source.start.bind(source);
          const stop = source.stop.bind(source);

          source.start = (when = 0, offset = 0) => {
            if (source.loop) {
              counters.music++;
              counters.duration = source.buffer?.duration ?? 0;
              counters.offsets.push(offset);
            } else {
              counters.clicks++;
            }

            start(when, offset);
          };

          source.stop = (when = 0) => {
            if (source.loop) {
              counters.stops++;
            }

            stop(when);
          };

          return source;
        }

        close() {
          counters.closed++;

          return super.close();
        }
      };
    });

    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;

      await route.fulfill({
        json:
          path === "/api/auth/get-session"
            ? {
                user: {
                  id: "sound-test",
                  name: "Sound Test",
                  email: "sound@example.test",
                  emailVerified: true,
                },
                session: {
                  id: "sound",
                  userId: "sound-test",
                  token: "sound",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                },
              }
            : path === "/api/preferences"
              ? DEFAULTS
              : path === "/api/weights"
                ? [
                    {
                      id: "published",
                      name: "Default",
                    },
                  ]
                : {},
      });
    });

    let send = (_packet: object) => {};
    const startedAt = Date.now() - 10000;
    const state = {
      kind: "state",
      status: "running",
      runId: "sound-test",
      startedAt,
      serverTime: Date.now(),
      keys: [],
      frame: null,
      trial: null,
      attempts: 0,
      accepted: 0,
      settings: DEFAULTS,
    };

    await page.routeWebSocket("**/live", (socket) => {
      send = (packet) => socket.send(JSON.stringify(packet));

      send({
        ...state,
        status: "idle",
        runId: undefined,
        startedAt: undefined,
      });
    });

    await page.goto(base, { waitUntil: "domcontentloaded" });
    const slider = page.getByRole("slider", { name: "Run playback time" });
    await page.getByRole("tab", { name: "Desk", exact: true }).waitFor();

    const press = async (name: string) => {
      const button = page.getByRole("button", { name, exact: true });
      await button.focus();
      await button.press("Space");
    };
    const reload = async () => {
      await page.waitForLoadState("networkidle");
      await Promise.all([
        page.waitForEvent("domcontentloaded"),
        page.evaluate(() => location.reload()),
      ]);
    };
    const counts = () => page.evaluate(() => window.__sound);
    const clicks = async (expected: number) =>
      page.waitForFunction(
        (count) => window.__sound.clicks === count,
        expected,
        { timeout: 5000 },
      );
    const key = async (id: number, lag = 0) => {
      const time = await page.evaluate(() => Date.now());

      send({
        kind: "motor",
        phase: "contact",
        key: "Digit3",
        hand: "left",
        contactId: id,
        effector: [0, 0, 0],
        left_effector: [0, 0, 0],
        right_effector: [0, 0, 0],
        time: time - lag,
      });

      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );

      return time;
    };

    await page.waitForFunction(() => window.__sound.attempts > 0);

    assert.equal(
      await slider.count(),
      0,
      "sound control exists before any run",
    );

    if (await page.evaluate(() => window.__context.state !== "running")) {
      await page.getByRole("heading", { name: "zetafly", exact: true }).click();
    }

    await page.waitForFunction(() => window.__sound.music === 1);

    assert.ok(
      (await counts()).duration > 0,
      "background music decodes before Start",
    );

    assert.equal((await counts()).clicks, 0);

    await page
      .getByRole("button", { name: "Mute sound", exact: true })
      .waitFor();

    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const keyboard = page.getByRole("switch", { name: "Keyboard sounds" });
    const music = page.getByRole("switch", { name: "Background music" });
    assert.equal(await keyboard.isChecked(), false);
    assert.equal(await music.isChecked(), true);

    assert.equal(
      await keyboard.isEnabled(),
      true,
      "sound remains adjustable during a run",
    );

    await keyboard.check();
    await page.getByRole("button", { name: "Close settings" }).click();
    send({ ...state, serverTime: await page.evaluate(() => Date.now()) });
    await slider.waitFor();
    await key(2);
    await clicks(1);
    assert.equal((await counts()).clicks, 1);
    await key(2);

    assert.equal(
      (await counts()).clicks,
      1,
      "repeated contact packet is not another keypress",
    );

    await key(3, 2000);
    await clicks(2);

    assert.equal(
      (await counts()).clicks,
      2,
      "same key with new contact sounds once",
    );

    await press("Pause playback");
    await key(4);

    assert.equal(
      (await counts()).clicks,
      2,
      "live packets cannot sound during paused replay",
    );

    await slider.focus();
    await page.keyboard.press("Home");
    await page.waitForTimeout(100);
    assert.equal((await counts()).clicks, 2, "seeking is silent");
    await page.keyboard.press("End");
    await page.waitForTimeout(100);

    assert.equal(
      (await counts()).clicks,
      2,
      "jump to live does not sound missed keys",
    );

    await press("Mute sound");
    await key(5);
    assert.equal((await counts()).clicks, 2);
    await press("Unmute sound");
    await key(6);
    await clicks(3);
    assert.equal((await counts()).clicks, 3);
    const beforeViews = await counts();

    for (const name of ["Keyboard", "Screen", "Brain", "Desk"]) {
      await page.getByRole("tab", { name, exact: true }).click();
    }

    assert.equal(
      (await counts()).music,
      beforeViews.music,
      "view changes cannot restart the track",
    );

    assert.equal(
      (await counts()).contexts - (await counts()).closed,
      1,
      "all sound shares one live AudioContext",
    );

    await press("Pause playback");

    assert.equal(
      (await counts()).stops,
      beforeViews.stops,
      "playback pause does not stop ambient music",
    );

    await press("Play recording");

    assert.equal(
      (await counts()).music,
      beforeViews.music,
      "playback resume does not restart ambient music",
    );

    await slider.focus();
    await slider.press("End");
    await page.getByText("LIVE", { exact: true }).waitFor();
    const beforeHide = await counts();

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });

      document.dispatchEvent(new Event("visibilitychange"));
    });

    const hiddenAt = await page.evaluate(() => window.__context.currentTime);

    await page.waitForFunction(
      (time) => window.__context.currentTime > time + 0.1,
      hiddenAt,
    );

    assert.equal(
      (await counts()).stops,
      beforeHide.stops + 1,
      "hidden tabs stop ambient music",
    );

    await key(7);

    assert.equal(
      (await counts()).clicks,
      3,
      "background tabs suppress keyboard clicks",
    );

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });

      document.dispatchEvent(new Event("visibilitychange"));
    });

    await page.waitForFunction(
      (count) => window.__sound.music === count + 1,
      beforeHide.music,
    );
    assert.ok(
      (await counts()).offsets.at(-1)! > 0,
      "returning resumes music from its saved position",
    );

    const lastKeyTime = await key(8);
    await clicks(4);

    assert.equal(
      (await counts()).clicks,
      4,
      "returning resumes new keys without a backlog",
    );

    const beforeEnd = await counts();

    send({
      ...state,
      status: "completed",
      endedAt: lastKeyTime + 10000,
    });

    await page
      .getByRole("button", { name: "Play recording", exact: true })
      .waitFor();

    assert.equal(
      (await counts()).stops,
      beforeEnd.stops,
      "run end keeps ambient music playing",
    );

    await page.getByRole("tab", { name: "Screen", exact: true }).click();
    const replayTime =
      Math.floor(((lastKeyTime - startedAt) / 1000 - 1) / 10) * 10;
    await slider.focus();
    await slider.press("Home");

    for (let time = 0; time < replayTime; time += 10) {
      await slider.press("PageUp");
    }

    assert.equal(Number(await slider.inputValue()), replayTime);

    const replayCount = (await counts()).clicks;
    await press("Play recording");

    await page.waitForFunction(
      (count) => window.__sound.clicks > count,
      replayCount,
    );

    await page.locator(".brain-timeline").hover();
    await page.screenshot({ path: `/tmp/zetafly-sound-${engine.name()}.png` });
    const newRunClicks = (await counts()).clicks;

    send({
      ...state,
      runId: "sound-next",
      serverTime: await page.evaluate(() => Date.now()),
      frame: null,
    });

    await page.getByText("LIVE", { exact: true }).waitFor();
    await page.waitForTimeout(100);
    await key(1);
    await clicks(newRunClicks + 1);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await music.uncheck();
    const offStops = (await counts()).stops;
    await reload();
    await page.getByRole("tab", { name: "Desk", exact: true }).waitFor();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await keyboard.isChecked(), true);

    assert.equal(
      await music.isChecked(),
      false,
      "saved music-off survives reload",
    );

    assert.equal(
      (await counts()).music,
      0,
      "saved music-off prevents autoplay",
    );

    assert.ok(offStops > 0);
    await music.check();
    await page.waitForFunction(() => window.__sound.music === 1);
    await page.getByRole("button", { name: "Close settings" }).click();
    await press("Mute sound");
    await reload();

    await page
      .getByRole("button", { name: "Unmute sound", exact: true })
      .waitFor();

    assert.equal(
      (await counts()).contexts,
      0,
      "saved mute prevents audio creation on load",
    );

    // Retain native decoding and audio nodes while simulating a gesture-only policy.
    await page.addInitScript(() => {
      const Native = window.AudioContext;
      let allowed = false;

      document.addEventListener(
        "click",
        (event) => {
          if (event.isTrusted) {
            allowed = true;
          }
        },
        true,
      );

      window.AudioContext = class extends Native {
        get state(): AudioContextState {
          return allowed ? super.state : "suspended";
        }

        resume() {
          return allowed ? super.resume() : new Promise<void>(() => {});
        }
      };
    });

    await page.evaluate(() => localStorage.removeItem("zetafly.sound"));
    await page.setViewportSize({ width: 375, height: 812 });
    await reload();

    const enable = page.getByRole("button", {
      name: "Enable sound",
      exact: true,
    });

    await enable.waitFor();

    assert.equal(
      (await counts()).music,
      0,
      "blocked autoplay cannot claim audible playback",
    );

    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 812 });

      const tabs = await page
        .getByRole("tablist", { name: "View" })
        .boundingBox();
      const button = await enable.boundingBox();
      assert.ok(tabs && button);
      assert.ok(tabs.x >= 0 && tabs.x + tabs.width <= width);
      assert.ok(button.x >= 0 && button.x + button.width <= width);
      assert.ok(button.width >= 44 && button.height >= 44);

      assert.ok(
        button.y + button.height + 12 <= tabs.y,
        `sound has its own corner, clear of navigation at ${width}px`,
      );
    }

    await page.setViewportSize({ width: 375, height: 812 });

    await page.screenshot({
      path: `/tmp/zetafly-sound-blocked-${engine.name()}.png`,
    });

    await enable.click();
    await page.waitForFunction(() => window.__sound.music === 1);

    await page
      .getByRole("button", { name: "Mute sound", exact: true })
      .waitFor();

    assert.equal(
      await slider.count(),
      0,
      "gesture starts lobby music without a run",
    );

    assert.deepEqual(errors, []);

    console.log(
      `${engine.name()}: ambient autoplay/gesture fallback before Start, keyboard dedup, pause/scrub, mute, views, hidden-tab pause and resume, run-independent ambience, replay, saved off/mute passed`,
    );
  } finally {
    await browser.close();
  }
}

import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";
import { DEFAULTS } from "../server/settings.ts";

const base = process.env.APP_URL ?? "http://localhost:3000";

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.clock.install();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const startedAt = Date.now() - 65_000;

    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json =
        path === "/api/auth/get-session"
          ? {
              user: {
                id: "playback-test",
                name: "Playback Test",
                email: "playback@example.test",
                emailVerified: true,
              },
              session: {
                id: "test",
                userId: "playback-test",
                token: "test",
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
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
              : {};

      await route.fulfill({ json });
    });

    let complete = async () => {};
    let sendScreen = (_png: string, _runId?: string, _time?: number) => {};
    let startNewRun = () => {};
    let screenRunId = "playback-test";
    let newRunStartedAt = 0;
    let finishIdle = async (_status: "completed" | "stopped") => {};

    await page.routeWebSocket("**/live", (socket) => {
      const state = {
        kind: "state",
        status: "running",
        runId: "playback-test",
        startedAt,
        keys: [],
        frame: null,
        trial: null,
        attempts: 1,
        accepted: 0,
        settings: DEFAULTS,
      };
      const send = (packet: object) => socket.send(JSON.stringify(packet));
      send(state);

      sendScreen = (png, runId = screenRunId, time = Date.now()) =>
        send({ kind: "screen", png, time, runId });

      startNewRun = () => {
        screenRunId = "next-run";
        newRunStartedAt = Date.now();

        send({
          ...state,
          status: "loading",
          runId: "next-run",
          startedAt: newRunStartedAt,
          frame: null,
        });
      };

      const packets = setInterval(
        () =>
          send({
            kind: "motor",
            phase: "release",
            key: "Digit3",
            hand: "left",
            effector: [-0.4, 1.457, -0.08],
            left_effector: [-0.4, 1.457, -0.08],
            right_effector: [0.18, 1.58, 0.53],
            time: Date.now(),
          }),
        25,
      );

      socket.onClose(() => clearInterval(packets));

      finishIdle = async (status) => {
        screenRunId = `idle-${status}`;
        clearInterval(packets);
        const now = await page.evaluate(() => Date.now());
        const finished = {
          ...state,
          runId: `idle-${status}`,
          startedAt: now - 10_000,
          frame: {
            phase: "release",
            left_effector: [-0.4, 1.457, -0.08],
            right_effector: [0.18, 1.58, 0.53],
          },
        };

        send({ ...finished, status: "running" });
        send({ ...finished, status, endedAt: now });
      };

      complete = async () => {
        clearInterval(packets);
        const endedAt = await page.evaluate(() => Date.now());
        send({ ...state, status: "completed", endedAt });
      };

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
            observationId: "test",
            startedAt: startedAt + 1000,
            recordedAt: startedAt + 2000,
            through: 250,
          },
        }),
      );
    });

    await page.goto(base);
    const slider = page.getByRole("slider", { name: "Run playback time" });
    await slider.waitFor();
    await page.waitForLoadState("networkidle");
    const desk = page.getByRole("tab", { name: "Desk", exact: true });
    await desk.focus();
    await page.keyboard.press("ArrowRight");

    assert.equal(
      await page
        .getByRole("tab", { name: "Keyboard", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );

    await page.keyboard.press("End");
    const deskCanvas = await page.locator(".world canvas").elementHandle();
    await page.getByRole("tab", { name: "Screen", exact: true }).click();
    await page.getByRole("tab", { name: "Desk", exact: true }).click();

    assert.equal(
      await deskCanvas!.evaluate(
        (canvas) => canvas === document.querySelector(".world canvas"),
      ),
      true,
      "changing views must preserve the desk canvas and animation state",
    );

    const brain = page.getByRole("tab", { name: "Brain", exact: true });
    await brain.click();
    assert.equal(await brain.getAttribute("aria-selected"), "true");

    assert.equal(
      await page.getByRole("tabpanel").getAttribute("aria-labelledby"),
      await brain.getAttribute("id"),
    );

    await page.keyboard.press("Tab");

    assert.ok(
      await page
        .getByRole("tabpanel")
        .evaluate((el) => el === document.activeElement),
    );

    await page
      .getByRole("button", { name: "Neural activity", exact: true })
      .click();

    await page.getByRole("tab", { name: "Desk", exact: true }).click();
    assert.equal(await page.locator(".spike-panel").count(), 0);
    await brain.click();

    assert.equal(
      await page
        .getByRole("button", { name: "Neural activity", exact: true })
        .getAttribute("aria-expanded"),
      "true",
      "neural activity stays open when returning to the brain view",
    );

    assert.ok(await page.locator(".spike-panel").isVisible());

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    assert.deepEqual(
      violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
      [],
    );

    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
    await page.mouse.down();

    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, {
      steps: 12,
    });

    const scrubEnd = await slider.getAttribute("max");
    await page.waitForTimeout(300);

    assert.equal(
      await slider.getAttribute("max"),
      scrubEnd,
      "the seek range must freeze during a drag",
    );

    await page.waitForFunction(
      () => {
        const input =
          document.querySelector<HTMLInputElement>(".timeline-seek");

        return (
          input &&
          Math.abs(Number(input.value) / Number(input.max) - 0.6) < 0.03
        );
      },
      undefined,
      { timeout: 5000 },
    );

    const dragged = Number(await slider.inputValue());

    assert.ok(
      Math.abs(dragged / Number(scrubEnd) - 0.6) < 0.03,
      `drag must follow the pointer across the track: ${dragged} / ${scrubEnd}`,
    );

    await page.mouse.up();

    await page
      .getByRole("button", { name: "Pause playback", exact: true })
      .click();

    const snapshot = () =>
      slider.evaluate((element) => {
        const input = element as HTMLInputElement;

        return { value: input.value, max: input.max };
      });
    const pauseClock = async () =>
      page.clock.pauseAt(
        new Date((await page.evaluate(() => Date.now())) + 60000),
      );
    const advancePlayback = async (milliseconds: number) => {
      const previous = Number(await slider.inputValue());
      await page.clock.fastForward(milliseconds);

      await page.waitForFunction(
        (previous) =>
          Number(
            document.querySelector<HTMLInputElement>(".timeline-seek")!.value,
          ) > previous,
        previous,
        { polling: 50 },
      );

      return Number(await slider.inputValue());
    };
    const paused = await snapshot();
    await page.waitForTimeout(700);

    assert.equal(
      (await snapshot()).value,
      paused.value,
      "paused recording time must stay fixed while the live edge advances",
    );

    assert.equal(
      (await snapshot()).max,
      paused.max,
      "paused thumb must not drift backwards as the live edge grows",
    );

    for (const fraction of [0, 0.9, 0.3]) {
      const track = (await slider.boundingBox())!;

      await page.mouse.move(
        track.x + track.width * 0.5,
        track.y + track.height / 2,
      );

      await page.mouse.down();

      await page.mouse.move(track.x + track.width * fraction, track.y - 30, {
        steps: 8,
      });

      await page.waitForFunction(
        ({ fraction, end }) => {
          const value = Number(
            document.querySelector<HTMLInputElement>(".timeline-seek")!.value,
          );

          return Math.abs(value / end - fraction) < 0.004;
        },
        { fraction, end: Number(paused.max) },
      );

      const selected = Number(await slider.inputValue());

      assert.ok(
        Math.abs(selected / Number(paused.max) - fraction) < 0.03,
        `captured drag must reach ${fraction} of the track: ${selected} / ${paused.max}`,
      );

      await page.mouse.up();

      assert.equal(
        await slider.getAttribute("max"),
        paused.max,
        "repeated paused drags must preserve the original seek domain",
      );

      assert.equal(
        Number(await slider.inputValue()),
        selected,
        "releasing a frozen seek edge must not jump to the advancing live edge",
      );
    }

    await slider.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    assert.equal(Number(await slider.inputValue()), 5);
    await page.keyboard.press("PageUp");
    assert.equal(Number(await slider.inputValue()), 15);
    await page.keyboard.press("PageDown");
    await page.keyboard.press("ArrowDown");
    assert.equal(Number(await slider.inputValue()), 0);
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(Number(await slider.inputValue()), 0.1);

    await page.screenshot({
      path: `/tmp/zetafly-playback-${engine.name()}.png`,
    });

    await page.locator(".brain-timeline").hover();
    await page.getByRole("combobox", { name: "Playback speed" }).click();
    await page.getByRole("option", { name: "0.25×", exact: true }).click();
    await page.waitForTimeout(2000);
    const beforeResume = await snapshot();
    await page.getByRole("button", { name: "Play recording" }).click();
    const resumed = await snapshot();

    assert.ok(
      Math.abs(
        Number(resumed.max) -
          Number(beforeResume.max) -
          (Number(resumed.value) - Number(beforeResume.value)),
      ) < 0.03,
      "resuming must advance the seek domain with the playhead, without jumping to the live edge",
    );

    assert.ok(
      Number(resumed.value) / Number(resumed.max) >=
        Number(beforeResume.value) / Number(beforeResume.max),
      "resuming must not move the thumb backwards",
    );

    assert.ok(
      Number(resumed.max) >= Number(paused.max),
      "the recorded range must not shrink on resume",
    );

    await page.waitForTimeout(1200);
    const later = await snapshot();

    assert.ok(
      Number(later.max) >= Number(paused.max),
      "the seekable range must follow recorded time without exposing future time",
    );

    assert.ok(
      Number(later.value) > Number(resumed.value),
      "slow replay must move forwards in absolute time",
    );

    const liveTrack = (await slider.boundingBox())!;

    await page.mouse.move(
      liveTrack.x + liveTrack.width * 0.5,
      liveTrack.y + liveTrack.height / 2,
    );

    await page.mouse.down();

    await page.mouse.move(
      liveTrack.x + liveTrack.width + 20,
      liveTrack.y - 30,
      { steps: 8 },
    );

    await page.mouse.up();
    await page.getByText("LIVE", { exact: true }).waitFor();
    await slider.focus();
    await page.keyboard.press("End");
    await page.getByText("LIVE", { exact: true }).waitFor();

    assert.ok(
      await slider.evaluate(
        (element) =>
          Math.abs(
            Number((element as HTMLInputElement).value) -
              Number((element as HTMLInputElement).max),
          ) < 0.001,
      ),
      "live must be at the seekable edge",
    );

    const speedControl = page.getByRole("combobox", { name: "Playback speed" });
    const chooseSpeed = async (rate: number) => {
      await page.locator(".brain-timeline").hover();
      await speedControl.click();
      await page.getByRole("option", { name: `${rate}×`, exact: true }).click();
    };

    await speedControl.click();

    for (const rate of [2, 4, 8]) {
      assert.equal(
        await page
          .getByRole("option", { name: `${rate}×`, exact: true })
          .getAttribute("aria-disabled"),
        "true",
      );
    }

    await page.keyboard.press("Escape");
    await pauseClock();
    await chooseSpeed(0.5);
    await page.clock.runFor(16);
    const livePosition = await advancePlayback(32);
    const slowed = await advancePlayback(1200);

    assert.ok(
      Math.abs(slowed - livePosition - 0.6) < 0.000001,
      `slow motion must advance continuously beyond the former live edge: ${livePosition} -> ${slowed}`,
    );

    assert.equal(await page.getByText("LIVE", { exact: true }).count(), 0);
    await chooseSpeed(8);
    await page.clock.runFor(16);
    await advancePlayback(1000);
    await page.getByText("LIVE", { exact: true }).waitFor();

    assert.match(
      await speedControl.innerText(),
      /1×/,
      "catching live restores normal speed",
    );

    await page.clock.resume();
    await desk.click();

    await page.locator(".brain-timeline").hover();
    await page.getByRole("button", { name: "Pause playback" }).click();
    const beforeCompletion = await snapshot();
    await complete();
    await page.getByRole("button", { name: "Start", exact: true }).waitFor();

    assert.equal(
      (await snapshot()).value,
      beforeCompletion.value,
      "completion must not move a paused recording time",
    );

    await pauseClock();
    await slider.focus();
    await page.keyboard.press("End");
    await page.locator(".brain-timeline").hover();
    await page.getByRole("button", { name: "Play recording" }).click();

    await page.waitForFunction(
      () =>
        Number(
          document.querySelector<HTMLInputElement>(".timeline-seek")!.value,
        ) === 0,
      undefined,
      { polling: 50 },
    );

    const replay = await advancePlayback(500);

    assert.ok(
      Math.abs(replay - 0.5) < 0.000001,
      `a finished run must replay from the start: ${replay}`,
    );

    await page.getByRole("button", { name: "Pause playback" }).click();

    for (const rate of [0.1, 0.25, 0.5, 1, 2, 4, 8]) {
      await slider.focus();
      await page.keyboard.press("Home");
      await chooseSpeed(rate);
      await page.clock.runFor(16);
      await page.getByRole("button", { name: "Play recording" }).click();
      const start = await advancePlayback(32);
      const advance = (await advancePlayback(1000)) - start;

      assert.ok(
        Math.abs(advance - rate) < 0.000001,
        `${rate}× must advance ${rate} seconds per second: ${advance}`,
      );

      await page.getByRole("button", { name: "Pause playback" }).click();
    }

    await page.clock.resume();
    await desk.click();
    await page.locator(".brain-timeline").hover();
    await page.getByRole("button", { name: "Play recording" }).click();

    for (const status of ["completed", "stopped"] as const) {
      await finishIdle(status);
      await page.getByRole("button", { name: "Start", exact: true }).waitFor();
      await slider.focus();
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowLeft");
      await chooseSpeed(8);
      await page.getByRole("button", { name: "Play recording" }).click();

      await page.waitForFunction(() => {
        const seek =
          document.querySelector<HTMLInputElement>(".timeline-seek")!;

        return (
          Number(seek.value) === Number(seek.max) &&
          document
            .querySelector(".timeline-play")
            ?.getAttribute("aria-label") === "Play recording"
        );
      });
    }

    await page.getByRole("tab", { name: "Screen", exact: true }).click();

    const screens = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      const context = canvas.getContext("2d")!;

      return ["#f00", "#0f0", "#00f"].map((color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 2, 2);

        return canvas.toDataURL().split(",")[1];
      });
    });

    sendScreen(screens[0]);
    const display = page.locator(".screen-view img");

    await page.waitForFunction(
      (png) =>
        document
          .querySelector<HTMLImageElement>(".screen-view img")
          ?.src.endsWith(png),
      screens[0],
    );

    const previousScreenRunId = screenRunId;
    startNewRun();
    await page.getByRole("button", { name: "Stop", exact: true }).waitFor();

    assert.equal(
      await display.count(),
      0,
      "starting must clear the previous run's screen",
    );

    sendScreen(screens[0], previousScreenRunId);
    await page.waitForTimeout(100);

    assert.equal(
      await display.count(),
      0,
      "late previous-run screens stay hidden",
    );

    sendScreen(screens[1], screenRunId, newRunStartedAt + 1000);

    await page.waitForFunction(
      (png) =>
        document
          .querySelector<HTMLImageElement>(".screen-view img")
          ?.src.endsWith(png),
      screens[1],
    );

    sendScreen(screens[2], screenRunId, newRunStartedAt + 2000);

    await page.waitForFunction(
      (png) =>
        document
          .querySelector<HTMLImageElement>(".screen-view img")
          ?.src.endsWith(png),
      screens[2],
    );

    await slider.focus();
    await page.keyboard.press("Home");

    assert.equal(
      await display.count(),
      0,
      "new history begins without a previous-run image",
    );

    for (let step = 0; step < 15; step++) {
      await page.keyboard.press("Shift+ArrowRight");
    }

    await page.waitForFunction(
      (png) =>
        document
          .querySelector<HTMLImageElement>(".screen-view img")
          ?.src.endsWith(png),
      screens[1],
    );

    await page.keyboard.press("End");

    await page.waitForFunction(
      (png) =>
        document
          .querySelector<HTMLImageElement>(".screen-view img")
          ?.src.endsWith(png),
      screens[2],
    );

    assert.deepEqual(errors, []);

    console.log(
      `${engine.name()}: stable seeks, seven rates, live catch-up, streamed motor packets, finished/stopped replay, and screen history passed`,
    );
  } finally {
    await browser.close();
  }
}

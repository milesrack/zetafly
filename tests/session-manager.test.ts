import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "../server/session.ts";
import { SessionManager } from "../server/session-manager.ts";

test("removing an account awaits its final run write and releases only its computer", async () => {
  const sessions = new SessionManager(
    {} as ConstructorParameters<typeof SessionManager>[0],
    () => {},
    {} as ConstructorParameters<typeof SessionManager>[2],
  );
  const closing = Promise.withResolvers<void>();
  let cleaned = false;
  sessions.current = {
    ownerId: "alice",
    session: { close: () => closing.promise } as unknown as Session,
    profileId: null,
    cleanup: async () => {
      cleaned = true;
    },
  };
  await sessions.remove("bob");
  assert.equal(sessions.current.ownerId, "alice");
  const removal = sessions.remove("alice");
  assert.equal(sessions.claiming, true);
  await assert.rejects(sessions.claim("bob"));
  assert.equal(cleaned, false);
  closing.resolve();
  await removal;
  assert.equal(cleaned, true);
  assert.equal(sessions.current, null);
  assert.equal(sessions.claiming, false);
});

test("another user cannot replace an active or preparing brain session", async () => {
  const sessions = new SessionManager(
    {} as unknown as ConstructorParameters<typeof SessionManager>[0],
    () => {},
    {} as unknown as ConstructorParameters<typeof SessionManager>[2],
  );

  sessions.current = {
    ownerId: "alice",
    session: {
      running: true,
      previewing: false,
      state: { status: "running" },
    } as unknown as Session,
    profileId: null,
  };

  await assert.rejects(
    sessions.claim("bob"),
    (error) =>
      error instanceof Error && "status" in error && error.status === 409,
  );

  sessions.current.session.running = false;
  sessions.current.session.previewing = true;

  await assert.rejects(
    sessions.claim("bob"),
    (error) =>
      error instanceof Error && "status" in error && error.status === 409,
  );

  assert.equal(sessions.state("bob").status, "idle");
  assert.equal(sessions.state("alice").status, "running");
});

test("stopping another account does not stop the owner", async () => {
  const sessions = new SessionManager(
    {} as unknown as ConstructorParameters<typeof SessionManager>[0],
    () => {},
    {} as unknown as ConstructorParameters<typeof SessionManager>[2],
  );
  let stopped = false;

  sessions.current = {
    ownerId: "alice",
    session: {
      stop: async () => {
        stopped = true;
      },
    } as unknown as Session,
    profileId: null,
  };

  await sessions.stop("bob");
  assert.equal(stopped, false);
  await sessions.stop("alice");
  assert.equal(stopped, true);
});

test("stopping a session cancels neural inference before waiting for its task", async () => {
  const { Session } = await import("../server/session.ts");
  const session = new Session(
    {} as unknown as ConstructorParameters<typeof Session>[0],
    () => {},
    "alice",
  );
  let complete!: () => void;
  session.running = true;

  session.task = new Promise<void>((resolve) => {
    complete = resolve;
  });

  session.worker = {
    close: async () => {
      assert.equal(session.running, false);
      complete();
    },
  } as unknown as Session["worker"];

  await session.stop();
  assert.equal(session.running, false);
});

test("concurrent previews wait for the computer to finish preparing", async () => {
  const { Session } = await import("../server/session.ts");
  const session = new Session(
    {} as unknown as ConstructorParameters<typeof Session>[0],
    () => {},
    "alice",
  );
  const opening = Promise.withResolvers<void>();
  session.computer.open = () => opening.promise;
  const first = session.preview();
  let secondReady = false;
  const second = session.preview().then(() => {
    secondReady = true;
  });

  try {
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(
      secondReady,
      false,
      "A concurrent preview reported readiness before the computer opened",
    );

    opening.resolve();
    await Promise.all([first, second]);
    assert.equal(secondReady, true);
  } finally {
    opening.resolve();
    await Promise.all([first, second]);
    await session.close();
  }
});

test("stopping during game setup never announces a running game", async () => {
  const { Session } = await import("../server/session.ts");
  const { DEFAULTS } = await import("../server/settings.ts");
  const opening = Promise.withResolvers<void>();
  const preparing = Promise.withResolvers<void>();
  const packets: string[] = [];
  const session = new Session(
    {
      collection: () => ({ insertOne: async () => {} }),
    } as unknown as ConstructorParameters<typeof Session>[0],
    (packet) => {
      if (packet.kind === "state") {
        packets.push(packet.status);
      }
    },
    "alice",
  );

  session.worker.start = async () => ({
    ready: true,
    neurons: 1,
    connections: 0,
  });

  session.worker.close = async () => {
    opening.resolve();
  };

  session.computer.startGame = async () => {
    preparing.resolve();
    await opening.promise;
  };

  session.start({ ...DEFAULTS });
  await preparing.promise;
  await session.stop();
  await session.close();
  assert.deepEqual(packets, ["loading", "stopped"]);
  assert.equal(session.state.frame, null);
});

test("late screenshots cannot overwrite a new run's screen", async () => {
  const { Session } = await import("../server/session.ts");
  const captured = Promise.withResolvers<string>();
  const session = new Session(
    {} as ConstructorParameters<typeof Session>[0],
    () => {
      assert.fail("A screenshot from the previous run was broadcast");
    },
    "alice",
  );

  session.computer.page = {} as NonNullable<Session["computer"]["page"]>;
  session.computer.screenshot = () => captured.promise;
  session.state.runId = "old";
  const task = session.capture();
  session.state.runId = "new";
  captured.resolve("old-screen");
  await task;
  assert.equal(session.screen, undefined);
});

test("preview preserves a stopped run's final screen", async () => {
  const { Session } = await import("../server/session.ts");
  const packets: unknown[] = [];
  const session = new Session(
    {} as ConstructorParameters<typeof Session>[0],
    (packet) => packets.push(packet),
    "alice",
  );

  session.screen = "final-screen";

  session.computer.open = async () => {
    assert.fail("Stopped computer reopened");
  };

  await session.preview();
  assert.deepEqual(packets, [{ kind: "screen", png: "final-screen" }]);
  assert.equal(session.captureTimer, undefined);
});

test("Zetamac completion cancels pending inference without ending the run early", async (context) => {
  const { Session } = await import("../server/session.ts");
  const { DEFAULTS } = await import("../server/settings.ts");
  context.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });

  const pending =
    Promise.withResolvers<Awaited<ReturnType<Session["worker"]["predict"]>>>();
  const predicting = Promise.withResolvers<void>();
  let finished = false;
  const session = new Session(
    {
      collection: () => ({ insertOne: async () => {} }),
    } as unknown as ConstructorParameters<typeof Session>[0],
    () => {},
    "alice",
  );

  session.worker.start = async () => ({
    ready: true,
    neurons: 1,
    connections: 0,
  });

  session.worker.predict = () => {
    predicting.resolve();

    return pending.promise;
  };

  session.worker.close = async () => {
    pending.reject(new Error("Worker closed"));
  };

  session.computer.startGame = async () => {};
  Object.assign(session.computer, { finished: async () => finished });

  session.computer.problem = async () => ({
    a: 1,
    b: 1,
    operation: "+",
    text: "1+1",
  });

  session.computer.score = async () => 0;
  session.start({ ...DEFAULTS, duration: 30 });
  await predicting.promise;
  let status: string;

  try {
    context.mock.timers.tick(23000);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(
      session.state.status,
      "running",
      "The last eight seconds belong to the run",
    );

    finished = true;
    context.mock.timers.tick(7000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    status = session.state.status;
  } finally {
    await session.close();
  }

  assert.equal(
    status,
    "completed",
    "Game completion must cancel an in-flight prediction",
  );
});

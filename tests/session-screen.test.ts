import assert from "node:assert/strict";
import test from "node:test";
import type { Db } from "mongodb";
import { Motor } from "../server/motor.ts";
import { Session } from "../server/session.ts";
import { DEFAULTS } from "../server/settings.ts";
import type { SessionPacket } from "../shared/contracts.ts";

test("fresh setup stays visible during model loading without starting the game", async () => {
  const packets: SessionPacket[] = [];
  const ready = Promise.withResolvers<void>();
  const loading = Promise.withResolvers<void>();
  const session = new Session(
    { collection: () => ({ insertOne: async () => {} }) } as unknown as Db,
    (packet) => packets.push(packet),
    "alice",
  );
  let page = "previous-results";
  session.computer.page = {} as NonNullable<Session["computer"]["page"]>;
  session.computer.screenshot = async () => page;

  session.worker.start = async () => {
    loading.resolve();
    await ready.promise;

    return { ready: true, neurons: 1, connections: 0 };
  };

  session.worker.close = async () => {};

  session.computer.startGame = async (_settings, prepared) => {
    page = "fresh-setup";
    await prepared?.();
    page = "first-problem";
  };

  session.computer.problem = async () => {
    throw Error("Fixture finished");
  };

  session.start(DEFAULTS);

  try {
    await loading.promise;

    assert.equal(page, "fresh-setup", "the game waits for model readiness");
    assert.deepEqual(
      packets
        .filter((packet) => packet.kind === "screen")
        .map((packet) => packet.png),
      ["fresh-setup"],
      "model loading shows fresh setup, never the previous game",
    );
  } finally {
    ready.resolve();
    await session.task;
  }

  const screens = packets.filter((packet) => packet.kind === "screen");
  assert.ok(screens.every((packet) => packet.runId === session.state.runId));

  assert.deepEqual(
    screens.map((packet) => packet.png),
    ["fresh-setup", "first-problem", "first-problem"],
  );
});

test("stopping during model loading leaves setup visible and never submits the game", async () => {
  const loading = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const session = new Session(
    { collection: () => ({ insertOne: async () => {} }) } as unknown as Db,
    () => {},
    "alice",
  );
  let submitted = false;
  session.computer.page = {} as NonNullable<Session["computer"]["page"]>;
  session.computer.screenshot = async () => "fresh-setup";
  session.computer.startGame = async (_settings, prepared) => {
    await prepared?.();
    submitted = true;
  };
  session.worker.start = async () => {
    loading.resolve();
    await ready.promise;

    return { ready: true, neurons: 1, connections: 0 };
  };
  session.worker.close = async () => ready.resolve();

  session.start(DEFAULTS);
  await loading.promise;
  await session.stop();

  assert.equal(submitted, false);
  assert.equal(session.state.status, "stopped");
  assert.equal(session.screen, "fresh-setup");
});

test("run feedback clears after acceptance, including identical next operands, and after a changed problem", async (context) => {
  const requests: string[][] = [];
  const session = new Session(
    { collection: () => ({ insertOne: async () => {} }) } as unknown as Db,
    () => {},
    "alice",
  );
  let score = 0;
  session.computer.page = {} as NonNullable<Session["computer"]["page"]>;
  session.computer.screenshot = async () => "fixture";
  session.computer.startGame = async () => {};
  session.computer.finished = async () => false;
  session.computer.score = async () => score;
  session.computer.problem = async () => ({
    a: 3,
    b: requests.length === 3 ? 57 : 56,
    operation: "*",
    text: "fixture",
  });
  session.worker.start = async () => ({
    ready: true,
    neurons: 1,
    connections: 0,
  });
  session.worker.close = async () => {};
  session.worker.predict = async (
    _a,
    _b,
    _seed,
    _operation,
    _activity,
    rejected = [],
  ) => {
    requests.push([...rejected]);

    if (requests.length === 4) {
      session.running = false;
    }

    return {
      id: requests.length,
      answer: requests.length === 2 ? 6 : 5,
      seconds: 0,
      observations: 1,
      downstreamSpikes: 0,
      activity: [],
    };
  };
  context.mock.method(Motor.prototype, "stroke", async (key: string) => {
    if (key === "Digit6") {
      score++;
    }
  });

  session.start(DEFAULTS);
  await session.task;
  assert.deepEqual(requests, [[], ["5"], [], []]);
  assert.equal(session.state.accepted, 1);
});

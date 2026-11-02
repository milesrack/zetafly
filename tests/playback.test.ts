import assert from "node:assert/strict";
import test from "node:test";
import type { NeuralActivity } from "../shared/contracts.ts";
import { activityAt } from "../web/src/session/activity.ts";
import { addRecording, recordingAt } from "../web/src/session/recordings.ts";

const neural: NeuralActivity = {
  spikes: [
    [1, 10],
    [2, 100],
  ],
  inputs: [1],
  totalSpikes: 2,
  population: 3,
  durationMs: 250,
};
const first = {
  observationId: "1:1",
  startedAt: 1000,
  recordedAt: 1500,
  through: 100,
};

test("progress extends one observation without mutating prior recordings", () => {
  const history = addRecording([], neural, first, 1000);
  const next = addRecording(
    history,
    neural,
    { ...first, recordedAt: 2000, through: 250 },
    1000,
  );

  assert.equal(next.length, 1);
  assert.equal(history[0].end, 0.5);
  assert.equal(next[0].end, 1);
  assert.equal(recordingAt(next, 0.5)?.time, 100);
  assert.equal(recordingAt(next, 0.75)?.time, 175);
});

test("seeking selects the right observation and leaves gaps quiet", () => {
  let history = addRecording([], neural, first, 1000);

  history = addRecording(
    history,
    neural,
    { observationId: "1:2", startedAt: 3000, recordedAt: 3500, through: 250 },
    1000,
  );

  assert.equal(recordingAt(history, -1), undefined);
  assert.equal(recordingAt(history, 0.25)?.time, 50);
  const gap = recordingAt(history, 1.5)!;
  assert.equal(activityAt(gap.neural, gap.time).size, 0);
  assert.equal(recordingAt(history, 2.25)?.time, 125);
});

test("rate checkpoints use step units rather than milliseconds", () => {
  const rates = {
    ...neural,
    spikes: [],
    durationMs: 0,
    rateSteps: 4,
    rates: [[1, 2, 0.8]],
  } satisfies NeuralActivity;
  const history = addRecording([], rates, { ...first, through: 4 }, 1000);
  assert.equal(recordingAt(history, 0.25)?.time, 2);
});

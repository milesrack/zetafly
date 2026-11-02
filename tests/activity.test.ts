import assert from "node:assert/strict";
import test from "node:test";
import type { NeuralActivity } from "../shared/contracts.ts";
import { activityAt } from "../web/src/session/activity.ts";

const recording: NeuralActivity = {
  spikes: [
    [1, 0],
    [2, 125],
    [3, 250],
  ],
  inputs: [1],
  totalSpikes: 3,
  population: 100,
  durationMs: 250,
};

test("recorded spikes play in simulation order, then fade instead of persisting", () => {
  assert.deepEqual([...activityAt(recording, 0).keys()], [1]);
  assert.deepEqual([...activityAt(recording, 125).keys()], [2]);
  assert.deepEqual([...activityAt(recording, 250).keys()], [3]);
  assert.equal(activityAt(recording, 400).size, 0);
  assert.equal(activityAt(undefined, 0).size, 0);
});

test("rate playback uses model steps and decays without accumulating a permanent heatmap", () => {
  const rates = {
    ...recording,
    spikes: [],
    durationMs: 0,
    rateSteps: 4,
    rates: [[2, 2, -0.8]],
  } satisfies NeuralActivity;

  assert.equal(activityAt(rates, 0).size, 0);
  assert.equal(activityAt(rates, 2).get(2), 0.8);
  assert.ok(activityAt(rates, 3).get(2)! < 0.8);
  assert.equal(activityAt(rates, 6).size, 0);
});

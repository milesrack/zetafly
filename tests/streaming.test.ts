import assert from "node:assert/strict";
import test from "node:test";
import { Brain } from "../research/simulator.ts";
import type { NeuralActivity } from "../shared/contracts.ts";

test("streaming reports progressive observations without changing neural output", () => {
  const graph = {
    inputs: Array.from({ length: 20 }, (_, i) => i),
    offsets: Uint32Array.from(
      Array.from({ length: 22 }, (_, i) => Math.min(i, 20)),
    ),
    edges: Uint32Array.from(Array.from({ length: 20 }, (_, i) => i)),
    post: new Uint32Array(20).fill(20),
    weights: new Float64Array(20).fill(0.02),
  };
  const brain = new Brain(graph);
  brain.size = 21;
  const baseline = brain.observe(9, 9);
  const spikes = structuredClone(brain.neural!.spikes);
  const progress: { neural: NeuralActivity; through: number }[] = [];
  const streamed = brain.observe(9, 9, {
    onProgress: (neural, through) =>
      progress.push({ neural: structuredClone(neural), through }),
  });

  assert.deepEqual(streamed.counts, baseline.counts);
  assert.deepEqual(brain.neural!.spikes, spikes);

  assert.ok(progress.length > 1);
  assert.equal(progress.at(-1)!.through, brain.neural!.durationMs);
  assert.ok(
    progress.every(
      (packet, i) => i === 0 || packet.through > progress[i - 1].through,
    ),
  );

  assert.ok(progress[0].neural.spikes.length > 0);
  assert.ok(progress[0].neural.spikes.length < spikes.length);

  for (const { neural, through } of progress) {
    assert.ok(neural.spikes.every(([, at]) => at < through));
  }

  assert.deepEqual(progress.at(-1)!.neural, brain.neural);
});

test("spiking state and delayed delivery continue across stimulus windows", () => {
  const graph = {
    inputs: [0],
    offsets: Uint32Array.of(0, 1, 1),
    edges: Uint32Array.of(0),
    post: Uint32Array.of(1),
    weights: Float64Array.of(0.05),
  };
  const whole = new Brain(graph);
  const expected = whole.stimulate([{ neuron: 0, rate: 100 }], {
    durationMs: 40,
    pattern: "regular",
  });
  const split = new Brain(graph);
  const first = split.stimulate([{ neuron: 0, rate: 100 }], {
    durationMs: 20,
    pattern: "regular",
  });
  const second = split.stimulate([{ neuron: 0, rate: 100 }], {
    durationMs: 20,
    pattern: "regular",
    reset: false,
  });
  assert.deepEqual(
    Float32Array.from(first.counts, (v, i) => v + second.counts[i]),
    expected.counts,
  );
  assert.ok(expected.counts[1] > 0);
  split.reset();
  assert.equal(
    split.stimulate([], { durationMs: 20 }).counts.reduce((a, b) => a + b, 0),
    0,
  );
});

test("cell-specific thresholds change excitability without changing the default reference", () => {
  const graph = {
    inputs: [0],
    offsets: Uint32Array.of(0, 1, 1),
    edges: Uint32Array.of(0),
    post: Uint32Array.of(1),
    weights: Float64Array.of(0.05),
  };
  const reference = new Brain(graph);
  const constrained = new Brain(graph, Float64Array.of(-0.045, -0.001));
  const stimuli = [{ neuron: 0, rate: 100 }];
  assert.ok(
    reference.stimulate(stimuli, { durationMs: 40, pattern: "regular" })
      .counts[1] > 0,
  );
  assert.equal(
    constrained.stimulate(stimuli, { durationMs: 40, pattern: "regular" })
      .counts[1],
    0,
  );
});

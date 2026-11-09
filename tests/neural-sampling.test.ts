import assert from "node:assert/strict";
import test from "node:test";
import { sampleNeurons } from "../shared/neural.ts";

test("strong sensory activity cannot hide weaker downstream activity at either display limit", () => {
  const inputs = Array.from({ length: 256 }, (_, id) => id);
  const ids = Array.from({ length: 512 }, (_, id) => id);
  const value = (id: number) => (id < 256 ? 1 : -0.1);
  const packet = sampleNeurons(ids, value, inputs, 192);
  const visible = sampleNeurons(packet, value, inputs, 48);

  assert.equal(packet.length, 192);
  assert.equal(visible.length, 48);
  for (const sample of [packet, visible]) {
    assert.ok(sample.some((id) => id < 256));
    assert.ok(sample.some((id) => id >= 256));
    assert.equal(new Set(sample).size, sample.length);
    assert.ok(sample.every((id) => ids.includes(id)));
  }
});

test("unused sampling capacity is filled from available neurons without duplicates", () => {
  const available = [0, 1, 2];
  const sampled = sampleNeurons(available, (id) => -id, [0], 8);
  assert.equal(sampled.length, available.length);
  assert.deepEqual(new Set(sampled), new Set(available));
  assert.equal(sampleNeurons(available, (id) => id, [], 2).length, 2);
  assert.deepEqual(
    sampleNeurons([], () => 0, [], 48),
    [],
  );
});

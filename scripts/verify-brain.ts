import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadGraph, sha256 } from "../server/brain/graph.ts";
import { Brain } from "../server/brain/model.ts";
import { decodePolicy } from "../server/brain/policy.ts";
import { restoreWeights } from "../server/brain/weights.ts";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    reference: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.model || !values.reference || !values.output) {
  throw Error(
    "Use --model weights.json --reference reference.json --output new-audit.json",
  );
}
const bytes = await readFile(values.model);
const graph = await loadGraph();
const brain = values.model.endsWith(".npz")
  ? restoreWeights(graph, bytes)
  : new Brain(graph, JSON.parse(bytes.toString()));
assert.ok(brain instanceof Brain);
const reference = JSON.parse(
  await readFile(values.reference, "utf8"),
) as Record<
  string,
  { expression: string; expected: string; estimate: number }[]
>;
const conditions: Record<string, unknown> = {};
for (const [name, rows] of Object.entries(reference)) {
  let correct = 0;
  let withinThree = 0;
  let maxDifference = 0;
  const byOperation: Record<string, { correct: number; total: number }> = {};
  for (const row of rows) {
    const estimate = brain.estimate(row.expression);
    const result = decodePolicy(brain, row.expression);
    assert.equal(result.terminated, true);
    assert.equal(
      result.answer,
      String(Math.round(row.estimate)),
      `Cross-runtime answer mismatch: ${row.expression}`,
    );
    maxDifference = Math.max(maxDifference, Math.abs(estimate - row.estimate));
    const hit = result.answer === row.expected;
    correct += Number(hit);
    withinThree += Number(
      Math.abs(Number(result.answer) - Number(row.expected)) <= 1,
    );
    const operation = row.expression.match(/[+*/-]/)![0];
    byOperation[operation] ??= { correct: 0, total: 0 };
    byOperation[operation].total++;
    byOperation[operation].correct += Number(hit);
  }
  assert.ok(maxDifference < 1e-4, `${name}: numeric parity failed`);
  conditions[name] = {
    correct,
    total: rows.length,
    withinThree,
    maxDifference,
    byOperation,
  };
}
const report = { checkpointSha256: sha256(bytes), conditions };
await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx",
});
console.log(JSON.stringify(report, null, 2));

import assert from "node:assert/strict";
import test from "node:test";
import { type ArithmeticPolicy, runPolicy } from "../server/brain/policy.ts";

function policy(keys: unknown[], maxKeys = keys.length): ArithmeticPolicy {
  let index = 0;

  return {
    limits: { maxKeys },
    resetRun() {
      index = 0;
    },
    beginProblem() {
      index = 0;
    },
    nextAction() {
      return keys[index++] as ReturnType<ArithmeticPolicy["nextAction"]>;
    },
  };
}

test("policy execution preserves emitted digits without arithmetic correction", () => {
  const model = policy(["0", "0", "9", "end"]);

  assert.deepEqual(runPolicy(model, "347+58"), {
    answer: "009",
    keys: ["0", "0", "9", "Enter"],
    terminated: true,
  });

  assert.deepEqual(runPolicy(model, "1000/25"), runPolicy(model, "347+58"));
});

test("policy execution rejects malformed, empty, and unterminated output", () => {
  for (const keys of [
    ["end"],
    ["-", "end"],
    ["1", "-", "end"],
    ["x"],
    ["1", "2"],
  ]) {
    assert.throws(() => runPolicy(policy(keys), "2+3"));
  }

  assert.throws(() => runPolicy(policy(["1", "end"]), "2**3"));
  assert.throws(() => runPolicy(policy(["1", "end"], Infinity), "2+3"));
});

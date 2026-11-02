import assert from "node:assert/strict";
import test from "node:test";
import {
  addMoment,
  type Moment,
  momentAt,
} from "../web/src/session/moments.ts";

test("screen and keyboard replay selects only the last captured state at the playhead", () => {
  const frames: Moment[] = [
    { time: 0, png: "first", frame: null },
    { time: 1, png: "first", frame: { phase: "contact", key: "Digit2" } },
    { time: 2, png: "second", frame: { phase: "release", key: "Digit2" } },
  ];

  assert.deepEqual(momentAt(frames, -1), undefined);
  assert.deepEqual(momentAt(frames, 1.5), frames[1]);
  assert.deepEqual(momentAt(frames, 2), frames[2]);
  assert.deepEqual(momentAt(frames, 50), frames[2]);
  assert.equal(momentAt([], 0), undefined);
});

test("a delayed screen capture is ordered by capture time without moving a later keyboard event", () => {
  let history: Moment[] = [{ time: 0, png: "initial", frame: null }];

  history = addMoment(history, {
    time: 2,
    frame: { phase: "contact", key: "Digit2" },
  });

  history = addMoment(history, { time: 1, png: "captured" });

  assert.deepEqual(
    history.map((m) => m.time),
    [0, 1, 2],
  );

  assert.deepEqual(momentAt(history, 1.5), {
    time: 1,
    png: "captured",
    frame: null,
  });

  assert.deepEqual(momentAt(history, 2), {
    time: 2,
    png: "captured",
    frame: { phase: "contact", key: "Digit2" },
  });
});

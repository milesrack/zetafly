import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { CONNECTIONS, loadGraph, POPULATION, sha256 } from "./graph.ts";
import { runPolicy } from "./policy.ts";
import { DEFAULT_WEIGHTS, restoreWeights } from "./weights.ts";

const bytes = await readFile(process.env.ZETAFLY_CHECKPOINT ?? DEFAULT_WEIGHTS);

if (
  process.env.ZETAFLY_CHECKPOINT_SHA256 &&
  sha256(bytes) !== process.env.ZETAFLY_CHECKPOINT_SHA256
) {
  throw Error("Selected checkpoint hash mismatch");
}

const brain = restoreWeights(await loadGraph(), bytes);
const send = (packet: unknown) =>
  process.stdout.write(`${JSON.stringify(packet)}\n`);

brain.resetRun();

send({ ready: true, neurons: POPULATION, connections: CONNECTIONS });

for await (const line of createInterface({ input: process.stdin })) {
  let id: unknown;

  try {
    const request = JSON.parse(line) as {
      id: number;
      a: number;
      b: number;
      operation: string;
      rejected?: string[];
    };

    id = request.id;

    if (
      !Number.isSafeInteger(id) ||
      !Number.isSafeInteger(request.a) ||
      !Number.isSafeInteger(request.b) ||
      !["+", "-", "*", "/"].includes(request.operation)
    ) {
      throw Error("Invalid model inference request");
    }

    const startedAt = Date.now();
    const started = performance.now();
    const rates: [number, number, number][] = [];
    let through = 0;
    const result = runPolicy(
      brain,
      `${request.a}${request.operation}${request.b}`,
      () => {
        const neural = brain.activity();
        rates.push(
          ...(neural.rates ?? []).filter(([, step]) => step > through),
        );
        through = Math.max(through, neural.rateSteps ?? 0);
        neural.rates = [...rates];

        send({
          kind: "activity",
          id,
          neural,
          timing: {
            observationId: String(id),
            startedAt,
            recordedAt: Date.now(),
            through: neural.rateSteps,
          },
        });
      },
      request.rejected,
    );
    const answer = Number(result.answer);

    if (!Number.isSafeInteger(answer)) {
      throw Error("Answer exceeds browser integer precision");
    }

    send({
      id,
      answer,
      answerText: String(answer),
      seconds: (performance.now() - started) / 1000,
      observations: 1,
      downstreamSpikes: 0,
      activeNeurons: brain.activeNeurons(),
      activity: brain.outputActivity(),
      neural: { ...brain.activity(), rates },
    });
  } catch (error) {
    brain.resetRun();

    send({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

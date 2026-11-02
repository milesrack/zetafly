import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type {
  Broadcast,
  Profile,
  RunEvent,
  SessionPacket,
  SessionState,
  Settings,
} from "../shared/contracts.ts";
import { BrowserComputer } from "./browser.ts";
import { asError } from "./errors.ts";
import { KEYS, Motor } from "./motor.ts";
import { NeuralWorker } from "./neural-worker.ts";
import { parseSettings } from "./settings.ts";

type SessionProfile = Omit<Profile, "sha256"> & { sha256: string | null };

export class Session {
  declare ownerId: string;
  declare db: Db;
  declare broadcast: Broadcast;
  declare computer: BrowserComputer;
  declare worker: NeuralWorker;
  declare state: SessionState;
  declare profile: SessionProfile | undefined;
  declare events: RunEvent[] | undefined;
  declare previewing: boolean | undefined;
  declare previewTask: Promise<void> | undefined;
  declare captureTask: Promise<void> | undefined;
  declare running: boolean | undefined;
  declare captureTimer: ReturnType<typeof setInterval> | undefined;
  declare screen: string | undefined;
  private screenReady = true;
  declare settings: Settings;
  declare task: Promise<void> | undefined;

  constructor(db: Db, broadcast: Broadcast, ownerId: string) {
    this.ownerId = ownerId;
    this.db = db;
    this.broadcast = broadcast;
    this.computer = new BrowserComputer();
    this.worker = new NeuralWorker();

    this.state = {
      status: "idle",
      keys: KEYS,
      frame: null,
      trial: null,
      attempts: 0,
      accepted: 0,
    };
  }

  async setProfile(profile: Profile, path: string | null) {
    await this.worker.close();
    this.worker = new NeuralWorker(path, profile.sha256);

    this.profile = {
      id: profile.id,
      name: profile.name,
      sha256: profile.sha256 ?? null,
      synaptic: profile.synaptic,
      features: profile.features,
      arithmeticMode: profile.arithmeticMode ?? "sequence",
    };
  }

  send(packet: SessionPacket) {
    this.broadcast(
      packet.kind === "state" ? { ...packet, serverTime: Date.now() } : packet,
    );
  }

  async publish(packet: RunEvent) {
    const event = { ...packet, time: Date.now() };

    if (this.events) {
      this.events.push(event);
    }

    if (packet.kind === "motor") {
      this.state.frame = packet;
    }

    this.send(event);
  }

  preview() {
    if (this.screen && !this.running) {
      this.send({
        kind: "screen",
        png: this.screen,
        ...(this.state.runId ? { runId: this.state.runId } : {}),
      });

      return Promise.resolve();
    }

    if (this.previewing) {
      return this.previewTask ?? Promise.resolve();
    }

    this.previewing = true;

    this.previewTask = this.computer
      .open()
      .then(() => {
        if (this.running) {
          this.startCapture();
        }

        return this.capture();
      })
      .finally(() => {
        this.previewing = false;
        this.previewTask = undefined;
      });

    return this.previewTask;
  }

  startCapture() {
    if (!this.captureTimer) {
      this.captureTimer = setInterval(
        () => this.capture().catch(() => {}),
        400,
      );
    }
  }

  async capture(fresh = false): Promise<void> {
    const runId = this.state.runId;

    if (!this.screenReady) {
      return;
    }

    if (this.captureTask) {
      await this.captureTask;

      if (!fresh) {
        return;
      }
    }

    if (
      !this.computer.page ||
      !this.screenReady ||
      this.state.runId !== runId
    ) {
      return;
    }

    const time = Date.now();
    const task = this.computer.screenshot().then((png) => {
      if (this.state.runId !== runId) {
        return;
      }

      this.screen = png;
      this.send({ kind: "screen", png, time, ...(runId ? { runId } : {}) });
    });

    this.captureTask = task;

    try {
      await task;
    } finally {
      if (this.captureTask === task) {
        this.captureTask = undefined;
      }
    }
  }

  start(options: unknown) {
    const settings = parseSettings(options);

    if (this.running || this.previewing) {
      throw new Error("Computer is busy");
    }

    clearInterval(this.captureTimer);
    this.captureTimer = undefined;
    this.screenReady = false;
    this.running = true;
    this.events = [];
    this.settings = settings;

    this.state = {
      ...this.state,
      status: "loading",
      runId: randomUUID(),
      startedAt: Date.now(),
      frame: null,
      endedAt: undefined,
      attempts: 0,
      accepted: 0,
      trial: null,
      neural: null,
      error: null,
      settings,
    };

    this.screen = undefined;
    this.send({ kind: "state", ...this.state });
    this.task = this.run();
  }

  async run() {
    const id = this.state.runId!;
    const startedAt = new Date(this.state.startedAt!);
    let gameFinished = false;
    let checkingEnd = false;
    let gameError: Error | undefined;
    let endWatcher: ReturnType<typeof setInterval> | undefined;
    let endTimeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (
        !this.running ||
        this.state.runId !== id ||
        gameFinished ||
        gameError
      ) {
        return;
      }

      gameFinished = !error;
      gameError = error;
      void this.worker.close().catch(() => {});
    };

    try {
      if (!this.running) {
        return;
      }

      await this.computer.startGame(this.settings, async () => {
        if (!this.running) {
          throw new Error("Run stopped");
        }

        this.screenReady = true;
        await this.capture(true);

        if (!this.running) {
          throw new Error("Run stopped");
        }

        await this.worker.start();

        if (!this.running) {
          throw new Error("Run stopped");
        }
      });

      if (!this.running) {
        return;
      }

      await this.capture(true);

      if (!this.running) {
        return;
      }

      this.state.status = "running";
      this.send({ kind: "state", ...this.state });

      const motor = new Motor(
        this.computer.page!,
        (event) => this.publish(event),
        () => !!this.running && !gameFinished && !gameError,
        this.state.startedAt,
      );

      this.startCapture();

      endWatcher = setInterval(() => {
        if (checkingEnd || !this.running) {
          return;
        }

        checkingEnd = true;

        this.computer
          .finished()
          .then((finished) => {
            if (finished) {
              finish();
            }
          })
          .catch((error) => finish(asError(error)))
          .finally(() => {
            checkingEnd = false;
          });
      }, 100);

      endTimeout = setTimeout(
        () => finish(new Error("Zetamac did not finish within its time limit")),
        (this.settings.duration + 10) * 1000,
      );

      let expression: string | undefined;
      let rejected: string[] = [];

      while (this.running && !gameFinished && !gameError) {
        const problem = await this.computer.problem();
        const current = `${problem.a}${problem.operation}${problem.b}`;

        if (current !== expression) {
          rejected = [];
          expression = current;
        }

        const previousScore = await this.computer.score();
        const prediction = await this.worker.predict(
          problem.a,
          problem.b,
          1000 + this.state.attempts,
          problem.operation,
          (packet) => {
            if (this.running && !gameFinished && !gameError) {
              this.state.neural = packet.neural;

              this.send({
                kind: "activity",
                neural: packet.neural,
                timing: packet.timing,
              });
            }
          },
          rejected,
        );

        if (!this.running || gameFinished || gameError) {
          break;
        }

        this.state.trial = {
          ...problem,
          ...prediction,
          answer: prediction.answer,
          answerSource: "model",
        };

        await this.publish({ kind: "prediction", ...this.state.trial });
        let accepted = false;
        let submitted = "";

        for (const digit of prediction.answerText ??
          String(prediction.answer)) {
          await motor.stroke(digit === "-" ? "Minus" : `Digit${digit}`);
          submitted += digit;
          // Zetamac accepts immediately; the next problem can have identical operands.
          await new Promise((r) => setTimeout(r, 100));

          if ((await this.computer.score()) > previousScore) {
            accepted = true;
            break;
          }
        }

        if (gameFinished || gameError) {
          break;
        }

        if (!this.running) {
          break;
        }

        this.state.attempts++;

        if (accepted) {
          this.state.accepted++;
          rejected = [];
        }

        await this.publish({
          kind: "attempt",
          a: problem.a,
          b: problem.b,
          operation: problem.operation,
          submitted: Number(submitted),
          answerSource: "model",
          accepted,
          attempts: this.state.attempts,
          score: this.state.accepted,
        });

        if (!accepted) {
          rejected.push(submitted);

          for (let i = 0; i < submitted.length; i++) {
            await motor.stroke("Backspace");
          }
        }

        this.send({ kind: "state", ...this.state });
      }

      if (gameError) {
        throw gameError;
      }

      this.state.status = this.running ? "completed" : "stopped";
    } catch (error) {
      this.state.status = !this.running
        ? "stopped"
        : gameFinished
          ? "completed"
          : "failed";

      if (this.state.status === "failed") {
        this.state.error = (gameError ?? asError(error)).message;
      }
    } finally {
      await this.worker.close();
      clearInterval(endWatcher);
      clearTimeout(endTimeout);

      if (["loading", "running"].includes(this.state.status)) {
        this.state.status = this.running ? "completed" : "stopped";
      }

      this.state.endedAt = Date.now();
      this.running = false;
      clearInterval(this.captureTimer);
      this.captureTimer = undefined;

      if (gameFinished) {
        await this.computer.waitForResults().catch(() => {});
      }

      await this.capture(true).catch(() => {});

      try {
        await this.db.collection("runs").insertOne({
          id,
          ownerId: this.ownerId,
          profile: this.profile,
          startedAt,
          finishedAt: new Date(),
          status: this.state.status,
          error: this.state.error,
          attempts: this.state.attempts,
          accepted: this.state.accepted,
          protocol: "model-policy-v3",
          settings: this.settings,
          events: this.events,
        });
      } catch {
        this.state.error =
          "Run ended, but MongoDB could not persist the evidence";

        this.state.status = "failed";
      }

      this.send({ kind: "state", ...this.state });
    }
  }

  async stop() {
    const active = this.running;
    this.running = false;

    if (active) {
      await this.worker.close();
    }

    await this.task;
  }

  async close() {
    await this.stop();
    clearInterval(this.captureTimer);
    await this.worker.close();
    await this.computer.close();
  }
}

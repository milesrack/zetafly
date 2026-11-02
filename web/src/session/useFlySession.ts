import { useEffect, useState } from "react";
import type {
  PhysicalFrame,
  SessionPacket,
  SessionState,
  Settings,
} from "../../../shared/contracts.ts";
import { request } from "../api";
import { addMoment, type Moment } from "./moments";
import { addRecording, type Recording } from "./recordings";

export function useFlySession(userId?: string) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [clockOffset, setClockOffset] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [state, setState] = useState<SessionState>({
    status: "idle",
    keys: [],
    frame: null,
    trial: null,
    attempts: 0,
    accepted: 0,
  });
  const [png, setPng] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConnected(false);
    setRecordings([]);
    setMoments([]);
    setClockOffset(0);
    setPng(null);
    setError("");

    setState({
      status: "idle",
      keys: [],
      frame: null,
      trial: null,
      attempts: 0,
      accepted: 0,
    });

    if (!userId) {
      return;
    }

    let runId: string | undefined;
    let origin = Date.now();
    let offset = 0;
    let active = false;
    let currentPng: string | null = null;
    let currentFrame: PhysicalFrame | null = null;
    const capture = (
      snapshot: Omit<Moment, "time">,
      time = Date.now() + offset,
    ) => {
      if (active) {
        setMoments((previous) =>
          addMoment(previous, {
            time: Math.max(0, (time - origin) / 1000),
            ...snapshot,
          }),
        );
      }
    };
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`,
      );

      const connection = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }

        request("preview")
          .catch((e) => {
            if (!disposed) {
              setError(e.message);
            }
          })
          .finally(() => {
            if (
              !disposed &&
              socket === connection &&
              connection.readyState === WebSocket.OPEN
            ) {
              setConnected(true);
            }
          });
      };

      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }

        const packet = JSON.parse(event.data) as SessionPacket;

        if (packet.kind === "screen") {
          if (packet.runId !== runId) {
            return;
          }

          setPng(packet.png);

          if (packet.png !== currentPng) {
            currentPng = packet.png;
            capture({ png: currentPng }, packet.time);
          }
        }

        if (packet.kind === "state") {
          if (
            active &&
            packet.runId === runId &&
            packet.status === "failed" &&
            packet.error
          ) {
            setError(
              /^Model (emitted|exceeded)/.test(packet.error)
                ? "The model did not produce a valid answer."
                : packet.error,
            );
          }

          if (packet.runId !== runId || packet.status === "loading") {
            setError("");
            setPng(null);
            currentPng = null;
            runId = packet.runId;
            setRecordings([]);
            setMoments([]);
            active = false;
            currentFrame = null;
          }

          origin = packet.startedAt ?? origin;

          if (packet.serverTime !== undefined) {
            offset = packet.serverTime - Date.now();
            setClockOffset(offset);
          }

          currentFrame = packet.frame;

          if (!active && ["loading", "running"].includes(packet.status)) {
            active = true;
            capture({ png: currentPng, frame: currentFrame }, origin);
          }

          if (active && !["loading", "running"].includes(packet.status)) {
            capture({ png: currentPng, frame: currentFrame }, packet.endedAt);
          }

          active = ["loading", "running"].includes(packet.status);
          setState(packet);
        }

        if (packet.kind === "motor") {
          currentFrame = packet;
          capture({ frame: currentFrame }, packet.time);
          setState((s) => ({ ...s, frame: packet }));
        }

        if (packet.kind === "activity") {
          setState((s) => ({ ...s, neural: packet.neural }));
          const timing = packet.timing;

          if (timing) {
            setRecordings((previous) =>
              addRecording(previous, packet.neural, timing, origin),
            );
          }
        }

        if (packet.kind === "prediction") {
          setState((s) => ({ ...s, trial: packet }));
        }

        if (packet.kind === "attempt") {
          setState((s) => ({
            ...s,
            attempts: packet.attempts,
            accepted: packet.score,
          }));
        }
      };

      socket.onclose = () => {
        if (!disposed) {
          setConnected(false);
          timer = setTimeout(connect, 1500);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      socket.close();
    };
  }, [userId]);

  async function act(action: string, settings?: Settings) {
    setError("");
    setBusy(true);

    try {
      await request(action, settings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    state,
    recordings,
    moments,
    clockOffset,
    png,
    error,
    connected,
    busy,
    act,
    clearError: () => setError(""),
  };
}

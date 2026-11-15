import { Activity } from "lucide-react";
import { useState } from "react";
import type { SessionState } from "../../../shared/contracts.ts";
import { usePlaybackSound } from "../audio/PlaybackSound";
import type { Sound } from "../audio/useSound";
import { BrainTimeline } from "../session/BrainTimeline";
import { type Moment, momentAt } from "../session/moments";
import type { Recording } from "../session/recordings";
import { usePlayback } from "../session/usePlayback";
import { BrainView } from "./BrainView";
import { NeuralActivity } from "./NeuralActivity";
import { World } from "./World";

export function SessionScene({
  sound,
  recordings,
  moments,
  state,
  png,
  view,
  clockOffset,
}: {
  sound: Sound;
  recordings: Recording[];
  moments: Moment[];
  state: SessionState;
  png: string | null;
  view: string;
  clockOffset: number;
}) {
  const [activity, setActivity] = useState(false);
  const playback = usePlayback(recordings, {
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    running: ["loading", "running"].includes(state.status),
    runId: state.runId,
    lastTime: moments.at(-1)?.time ?? 0,
    clockOffset,
  });

  usePlaybackSound(moments, playback, state.runId, state.frame, sound);
  const moment = momentAt(moments, playback.position);
  const screen = playback.following ? png : (moment?.png ?? null);
  const frame = playback.following ? state.frame : (moment?.frame ?? null);

  return (
    <>
      <p className="sr-only" role="status" aria-atomic="true">
        Run {state.status}.
        {!["loading", "running"].includes(state.status) &&
          ` ${state.accepted} accepted answers from ${state.attempts} attempts.`}
      </p>
      <p className="sr-only">
        Current run: {state.accepted} accepted answers from {state.attempts}{" "}
        attempts.
        {state.trial &&
          ` Latest problem: ${state.trial.text}. Predicted answer: ${state.trial.answer}.`}
      </p>
      <World
        png={screen}
        frame={frame}
        keys={state.keys}
        view={view}
        hidden={view === "screen" || view === "brain"}
        live={playback.following}
        time={playback.position}
        idle={
          !state.startedAt ||
          (playback.following && !["loading", "running"].includes(state.status))
        }
      />
      {view === "brain" ? (
        <BrainView
          neural={playback.selected?.neural}
          time={playback.selected?.time ?? 0}
        />
      ) : view === "screen" ? (
        <div
          className="screen-view flex items-center justify-center bg-white"
          role="img"
          aria-label={
            screen
              ? playback.following
                ? "Live Zetamac screen"
                : "Recorded Zetamac screen"
              : "Computer screen is off"
          }
        >
          {screen && (
            <img
              alt="Zetamac browser"
              src={`data:image/png;base64,${screen}`}
            />
          )}
        </div>
      ) : null}
      {(recordings.length > 0 || moments.length > 0) && (
        <BrainTimeline playback={playback} />
      )}
      {view === "brain" && (
        <>
          <button
            type="button"
            className="activity-button absolute top-4.5 right-6 flex items-center gap-1.75 border-0 bg-transparent rounded-[var(--control-radius)] text-[11px] py-2 px-2.5 text-[var(--muted-text)]"
            aria-expanded={activity}
            onClick={() => setActivity(!activity)}
          >
            <Activity aria-hidden="true" />
            Neural activity
          </button>
          {activity && (
            <aside className="spike-panel absolute right-6 top-15.5 w-105 max-w-[calc(100%_-_48px)] bg-[#ffffffed] border border-solid border-[#e3e6eb] rounded-[var(--surface-radius)] p-4.5">
              <NeuralActivity
                neural={playback.selected?.neural}
                time={playback.selected?.time}
              />
            </aside>
          )}
        </>
      )}
    </>
  );
}

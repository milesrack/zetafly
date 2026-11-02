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
          className="screen-view"
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
            className="activity-button"
            aria-expanded={activity}
            onClick={() => setActivity(!activity)}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M1 9h3l2-5 3 10 3-7 2 2h3" />
            </svg>
            Neural activity
          </button>
          {activity && (
            <aside className="spike-panel">
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

import { useEffect, useRef, useState } from "react";
import type { AttemptEvent, RunRecord } from "../../../shared/contracts.ts";
import { apiFetch } from "../api";

export function RunDetails({ id, back }: { id: string; back: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [exportError, setExportError] = useState(false);
  const [exportUrl, setExportUrl] = useState("");

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retrying must restart the request even when the run ID is unchanged.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      try {
        const response = await apiFetch(`/api/runs/${encodeURIComponent(id)}`, {
          signal,
        });
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "This run is no longer available."
              : "Could not load run details.",
          );
        }

        const record: RunRecord = await response.json();
        if (!signal.aborted) {
          setRun(record);
        }
      } catch (error) {
        if (!signal.aborted) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not load run details.",
          );
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [id, attempt]);

  useEffect(() => {
    if (!run) {
      return;
    }

    try {
      const blob = new Blob([JSON.stringify(run, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      setExportUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    }
  }, [run]);

  const attempts = (run?.events ?? []).filter(
    (event): event is AttemptEvent & { time?: number } =>
      event.kind === "attempt",
  );

  return (
    <div className="account-content run-details">
      <button type="button" onClick={back}>
        Back to history
      </button>
      <h3 ref={heading} tabIndex={-1}>
        Run details
      </h3>
      {error ? (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </>
      ) : !run ? (
        <p role="status">Loading run details…</p>
      ) : (
        <>
          {exportUrl && (
            <a
              className="run-export"
              href={exportUrl}
              download={`zetafly-run-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`}
            >
              Export JSON
            </a>
          )}
          {exportError && (
            <p className="form-error" role="alert">
              Could not prepare the export. Reopen this run to try again.
            </p>
          )}
          <h4>Results</h4>
          <dl>
            <dt>Run ID</dt>
            <dd>{run.id}</dd>
            <dt>Started</dt>
            <dd>{new Date(run.startedAt).toLocaleString()}</dd>
            <dt>Finished</dt>
            <dd>{new Date(run.finishedAt).toLocaleString()}</dd>
            <dt>Status</dt>
            <dd>{run.status}</dd>
            <dt>Score</dt>
            <dd>{run.accepted}</dd>
            <dt>Attempts</dt>
            <dd>{run.attempts}</dd>
            {run.error && (
              <>
                <dt>Error</dt>
                <dd>{run.error}</dd>
              </>
            )}
          </dl>
          <h4>Model</h4>
          <dl>
            <dt>Profile</dt>
            <dd>{run.profile?.name || "Unknown profile"}</dd>
            <dt>Profile ID</dt>
            <dd>{run.profile?.id ?? run.settings.profileId}</dd>
            {run.profile?.sha256 && (
              <>
                <dt>SHA-256</dt>
                <dd>{run.profile.sha256}</dd>
              </>
            )}
          </dl>
          <h4>Settings</h4>
          <dl>
            <dt>Duration</dt>
            <dd>{run.settings.duration} seconds</dd>
            {(
              [
                ["add", "Addition"],
                ["sub", "Subtraction"],
                ["mul", "Multiplication"],
                ["div", "Division"],
              ] as const
            ).map(([operation, label]) => (
              <div key={operation}>
                <dt>{label}</dt>
                <dd>{run.settings[operation] ? "Enabled" : "Disabled"}</dd>
              </div>
            ))}
            <dt>Addition/subtraction ranges</dt>
            <dd>
              {run.settings.add_left_min}–{run.settings.add_left_max} and{" "}
              {run.settings.add_right_min}–{run.settings.add_right_max}
            </dd>
            <dt>Multiplication/division ranges</dt>
            <dd>
              {run.settings.mul_left_min}–{run.settings.mul_left_max} and{" "}
              {run.settings.mul_right_min}–{run.settings.mul_right_max}
            </dd>
          </dl>
          <h4>Attempt history</h4>
          {attempts.length === 0 ? (
            <p>No recorded attempts.</p>
          ) : (
            <section
              className="run-attempts"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable attempt table needs a keyboard focus target.
              tabIndex={0}
              aria-label="Attempt history"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Attempt</th>
                    <th scope="col">Problem</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((event) => (
                    <tr key={event.attempts}>
                      <td>{event.attempts}</td>
                      <td>
                        {event.a} {event.operation} {event.b}
                      </td>
                      <td>{event.submitted}</td>
                      <td>{event.accepted ? "Accepted" : "Rejected"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

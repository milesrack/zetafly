import { ChevronLeft, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AttemptEvent, RunRecord } from "../../../shared/contracts.ts";
import { apiFetch } from "../api";
import { RunSummaryMetadata } from "./RunSummaryMetadata";

export function RunDetails({
  id,
  back,
  close,
}: {
  id: string;
  back: () => void;
  close: () => void;
}) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [exportError, setExportError] = useState(false);
  const [exportUrl, setExportUrl] = useState("");

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
    <>
      <div className="drawer-heading flex justify-between items-center py-4.5 px-6 border-b border-solid border-b-[#eeeff2]">
        <div className="run-detail-heading flex items-center gap-2">
          <button
            type="button"
            className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
            aria-label="History"
            onClick={back}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <h2 id="run-detail-title" tabIndex={-1}>
            Run {id.slice(0, 8)}
          </h2>
        </div>
        <div className="run-detail-actions flex items-center shrink-0 gap-2">
          {exportUrl && (
            <a
              className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
              title="Export JSON"
              href={exportUrl}
              download={`zetafly-run-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`}
            >
              <Download aria-hidden="true" />
              <span className="sr-only">Export JSON</span>
            </a>
          )}
          <button
            type="button"
            className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
            onClick={close}
            aria-label="Close history"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="account-content p-6 run-details">
        {error ? (
          <>
            <p
              className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
              role="alert"
            >
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
            {exportError && (
              <p
                className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
                role="alert"
              >
                Could not prepare the export. Reopen this run to try again.
              </p>
            )}
            <div className="flex items-center justify-between gap-2 [border-bottom:1px_solid_#eeeff2] pb-4 text-[13px]">
              <div className="run-row-main">
                <RunSummaryMetadata run={run} />
              </div>
              <strong className="run-detail-score shrink-0 tabular-nums">
                {run.accepted}/{run.attempts}
                <span className="sr-only"> correct</span>
              </strong>
            </div>
            {run.error && (
              <p className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]">
                {run.error}
              </p>
            )}
            <h3>Attempt history</h3>
            {attempts.length === 0 ? (
              <p>No recorded attempts.</p>
            ) : (
              <section
                className="run-attempts overflow-x-auto max-h-70"
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
                        <td>{event.accepted ? "Correct" : "Incorrect"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            <details className="run-metadata mt-4 border-t border-solid border-t-[#eeeff2]">
              <summary>Model and settings</summary>
              <dl>
                <dt>Run ID</dt>
                <dd>{run.id}</dd>
                <dt>Finished</dt>
                <dd>{new Date(run.finishedAt).toLocaleString()}</dd>
                <dt>Profile ID</dt>
                <dd>{run.profile?.id ?? run.settings.profileId}</dd>
                {run.profile?.sha256 && (
                  <>
                    <dt>SHA-256</dt>
                    <dd>{run.profile.sha256}</dd>
                  </>
                )}
              </dl>
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
            </details>
          </>
        )}
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import type { RunSummary } from "../../../shared/contracts.ts";
import { apiFetch } from "../api";
import { outsideDialog } from "../components/dialog";
import { RunDetails } from "./RunDetails";
import { RunSummaryMetadata } from "./RunSummaryMetadata";

const pageSize = 10;
export function RunHistory({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const listBody = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState({ query: "", page: 1, delay: 0 });
  const [result, setResult] = useState<
    { runs: RunSummary[]; total: number } | "error" | null
  >(null);
  const [loading, setLoading] = useState(true);
  const { query, page } = search;

  useEffect(() => {
    if (!selectedId) {
      selectedButton.current?.focus();
    } else {
      dialog.current?.querySelector<HTMLElement>("#run-detail-title")?.focus();
    }
  }, [selectedId]);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();

    return () => modal?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function fetchRuns() {
      const params = new URLSearchParams({
        q: search.query.trim(),
        page: String(search.page),
        limit: String(pageSize),
      });

      try {
        const response = await apiFetch(`/api/runs?${params}`, { signal });
        const count = response.headers.get("X-Total-Count");
        const total = Number(count);

        if (
          !response.ok ||
          count === null ||
          !Number.isSafeInteger(total) ||
          total < 0
        ) {
          throw new Error("Could not load run history");
        }

        const runs: RunSummary[] = await response.json();
        if (!signal.aborted) {
          setResult({ runs, total });
        }
      } catch {
        if (!signal.aborted) {
          setResult("error");
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    }

    const timer = search.delay
      ? setTimeout(fetchRuns, search.delay)
      : undefined;
    if (!timer) {
      void fetchRuns();
    }

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  function load(query: string, page: number, delay = 0) {
    listBody.current?.scrollTo(0, 0);
    setLoading(true);
    setSearch({ query, page, delay });
  }

  const pages =
    result && result !== "error" ? Math.ceil(result.total / pageSize) : 0;

  return (
    <dialog
      ref={dialog}
      className={
        selectedId
          ? "account-dialog run-history"
          : "account-dialog run-history run-history-list-view"
      }
      aria-label="Run history"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
      onClick={(event) => outsideDialog(event, close)}
    >
      {selectedId ? (
        <RunDetails
          key={selectedId}
          id={selectedId}
          back={() => setSelectedId(null)}
          close={close}
        />
      ) : (
        <div className="drawer-heading">
          <h2>Run history</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close history"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
      )}
      <div className="run-list-panel" hidden={selectedId !== null}>
        <div className="account-content run-list-content">
          <label>
            Search runs
            <span className="run-search">
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <circle cx="8.5" cy="8.5" r="4.5" />
                <path d="m12 12 4 4" />
              </svg>
              <input
                type="search"
                maxLength={100}
                placeholder="Weights, status, or run ID"
                value={query}
                onChange={(event) => load(event.target.value, 1, 200)}
              />
            </span>
          </label>
          <div ref={listBody} className="run-list-body" aria-busy={loading}>
            {loading && (
              <span className="run-loading-status" role="status">
                Loading runs…
              </span>
            )}
            {loading && !result && (
              <div className="run-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            )}
            {result === "error" && !loading ? (
              <>
                <p className="form-error" role="alert">
                  Could not load runs.
                </p>
                <button type="button" onClick={() => load(query, page)}>
                  Retry
                </button>
              </>
            ) : null}
            {!loading &&
              result &&
              result !== "error" &&
              result.runs.length === 0 && (
                <p role="status">
                  {query.trim()
                    ? "No runs match your search."
                    : "No previous runs."}
                </p>
              )}
            {result && result !== "error" && result.runs.length > 0 && (
              <ul className="run-history-list" aria-busy={loading}>
                {result.runs.map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      className="run-history-open"
                      aria-description={`Run ID ${run.id}`}
                      aria-disabled={loading}
                      onClick={(event) => {
                        if (loading) {
                          return;
                        }
                        selectedButton.current = event.currentTarget;
                        setSelectedId(run.id);
                      }}
                    >
                      <span className="run-row-main">
                        <strong className="run-reference" title={run.id}>
                          Run {run.id.slice(0, 8)}
                        </strong>
                        <RunSummaryMetadata run={run} />
                      </span>
                      <span className="run-row-result">
                        <strong>
                          {typeof run.attempts === "number"
                            ? `${run.accepted}/${run.attempts}`
                            : run.accepted}
                        </strong>
                        <span className="sr-only">correct</span>
                      </span>
                      <svg
                        className="run-row-arrow"
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                      >
                        <path d="m8 5 5 5-5 5" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {(page > 1 || pages > 1) && (
            <nav
              className="run-history-pages"
              aria-label="Run history pagination"
            >
              <button
                type="button"
                aria-label="Previous page"
                disabled={loading || page === 1}
                onClick={() => load(query, page - 1)}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="m12 5-5 5 5 5" />
                </svg>
              </button>
              <span role="status">
                {pages ? `Page ${page} of ${pages}` : `Page ${page}`}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={loading || page >= pages}
                onClick={() => load(query, page + 1)}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="m8 5 5 5-5 5" />
                </svg>
              </button>
            </nav>
          )}
        </div>
      </div>
    </dialog>
  );
}

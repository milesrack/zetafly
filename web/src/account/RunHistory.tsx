import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
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
          ? "account-dialog w-87.5 max-w-[calc(100vw_-_32px)] p-0 border border-solid border-[#e2e5ea] rounded-[var(--surface-radius)] text-[#18191c] bg-white run-history w-115 h-[min(600px,_calc(100dvh_-_32px))] overscroll-contain"
          : "account-dialog w-87.5 max-w-[calc(100vw_-_32px)] p-0 border border-solid border-[#e2e5ea] rounded-[var(--surface-radius)] text-[#18191c] bg-white run-history w-115 h-[min(600px,_calc(100dvh_-_32px))] overscroll-contain run-history-list-view overflow-hidden"
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
        <div className="drawer-heading flex justify-between items-center py-4.5 px-6 border-b border-solid border-b-[#eeeff2]">
          <h2>Run history</h2>
          <button
            type="button"
            className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
            onClick={close}
            aria-label="Close history"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="run-list-panel" hidden={selectedId !== null}>
        <div className="account-content p-6 run-list-content">
          <label>
            Search runs
            <span className="run-search relative block">
              <Search aria-hidden="true" />
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
              <div
                className="run-skeleton border-t border-solid border-t-[#eeeff2]"
                aria-hidden="true"
              >
                <span />
                <span />
                <span />
                <span />
              </div>
            )}
            {result === "error" && !loading ? (
              <>
                <p
                  className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
                  role="alert"
                >
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
              <ul
                className="run-history-list list-none m-0 p-0 border-t border-solid border-t-[#eeeff2]"
                aria-busy={loading}
              >
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
                        <strong
                          className="run-reference tabular-nums"
                          title={run.id}
                        >
                          Run {run.id.slice(0, 8)}
                        </strong>
                        <RunSummaryMetadata run={run} />
                      </span>
                      <span className="run-row-result text-right">
                        <strong>
                          {typeof run.attempts === "number"
                            ? `${run.accepted}/${run.attempts}`
                            : run.accepted}
                        </strong>
                        <span className="sr-only">correct</span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="run-row-arrow"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {(page > 1 || pages > 1) && (
            <nav
              className="run-history-pages grid grid-cols-[minmax(0,_1fr)_auto_minmax(0,_1fr)] items-center justify-items-center gap-2 mt-4 text-[12px]"
              aria-label="Run history pagination"
            >
              <button
                type="button"
                aria-label="Previous page"
                disabled={loading || page === 1}
                onClick={() => load(query, page - 1)}
              >
                <ChevronLeft aria-hidden="true" />
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
                <ChevronRight aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      </div>
    </dialog>
  );
}

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { outsideDialog } from "../components/dialog";
import { authClient } from "./auth-client";

export function DeleteAccount({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const dismiss = () => {
    if (!busy) {
      close();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="account-dialog w-87.5 max-w-[calc(100vw_-_32px)] p-0 border border-solid border-[#e2e5ea] rounded-[var(--surface-radius)] text-[#18191c] bg-white"
      aria-label="Delete account"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
        }
      }}
      onClick={(event) => outsideDialog(event, dismiss)}
    >
      <div className="drawer-heading flex justify-between items-center py-4.5 px-6 border-b border-solid border-b-[#eeeff2]">
        <h2>Delete account</h2>
        <button
          type="button"
          className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
          aria-label="Cancel account deletion"
          disabled={busy}
          onClick={dismiss}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <form
        className="account-content p-6"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError("");

          try {
            const result = await authClient.deleteUser({
              password: String(data.get("password")),
            });

            if (result.error) {
              throw Error(result.error.message ?? "Could not delete account");
            }

            close();
          } catch (error) {
            setError((error as Error).message);
            setBusy(false);
          }
        }}
      >
        <p className="email-confirmation" id="delete-account-warning">
          This permanently deletes your account, saved runs, preferences and
          uploaded weights. Any active run will stop. This cannot be undone.
        </p>
        <label>
          Current password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={busy}
          />
        </label>
        <label className="delete-confirmation">
          <input type="checkbox" required disabled={busy} />
          <span>
            I understand my account and data will be permanently deleted.
          </span>
        </label>
        {error && (
          <p
            className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
            role="alert"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          className="form-submit w-full min-h-10.5 border border-solid border-[#1b1d22] bg-[#1b1d22] text-white rounded-[var(--control-radius)] p-2.5 text-[12px] delete-account-button"
          disabled={busy}
          aria-describedby="delete-account-warning"
        >
          {busy ? "Deleting account…" : "Delete account permanently"}
        </button>
        <button
          type="button"
          className="auth-switch w-full min-h-10 mt-3 p-2 bg-transparent border-0 rounded-[var(--control-radius)] text-[12px] text-[#586271]"
          disabled={busy}
          onClick={dismiss}
        >
          Cancel
        </button>
      </form>
    </dialog>
  );
}

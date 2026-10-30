import { useEffect, useRef, useState } from "react";
import { renewAccess } from "../api";
import { outsideDialog } from "../components/dialog";
import { authClient } from "./auth-client";
import { PasswordInput } from "./PasswordInput";

export function ChangePassword({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function dismiss() {
    if (!busy) {
      close();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="account-dialog"
      aria-label="Change password"
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
      <div className="drawer-heading">
        <h2>Change password</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close password change"
          disabled={busy}
          onClick={dismiss}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>
      {changed ? (
        <div className="account-content">
          <p className="email-confirmation" role="status">
            Your password has been changed. Your other sessions have been logged
            out.
          </p>
          <button type="button" className="form-submit" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="account-content"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const newPassword = String(data.get("newPassword"));
            setError("");

            if (newPassword !== data.get("confirmation")) {
              setError("New passwords do not match.");
              return;
            }

            setBusy(true);
            try {
              const result = await authClient.changePassword({
                currentPassword: String(data.get("currentPassword")),
                newPassword,
                revokeOtherSessions: true,
              });

              if (result.error) {
                throw Error(
                  result.error.message ?? "Could not change password",
                );
              }

              form.reset();
              setChanged(true);
              await renewAccess().catch(() => false);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={busy}
            />
          </label>
          <div className="password-field">
            <div className="password-heading">
              <label htmlFor="change-new-password">New password</label>
            </div>
            <PasswordInput
              creating
              id="change-new-password"
              name="newPassword"
              disabled={busy}
            />
          </div>
          <label>
            Confirm new password
            <input
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              disabled={busy}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="form-submit" disabled={busy}>
            {busy ? "Changing password…" : "Change password"}
          </button>
          <button
            type="button"
            className="auth-switch"
            disabled={busy}
            onClick={dismiss}
          >
            Cancel
          </button>
        </form>
      )}
    </dialog>
  );
}

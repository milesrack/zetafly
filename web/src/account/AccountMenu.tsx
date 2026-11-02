import { useEffect, useRef, useState } from "react";
import { authClient, type User } from "./auth-client";

export function AccountMenu({
  user,
  verify,
  settings,
}: {
  user: User;
  verify: () => void;
  settings: () => void;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(0), 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  async function logout() {
    setBusy(true);
    setError("");

    try {
      const result = await authClient.signOut();

      if (result.error) {
        throw Error(result.error.message);
      }

      popover.current?.hidePopover();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="account-button"
        aria-label="Account"
        popoverTarget="account-menu"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      <div
        ref={popover}
        id="account-menu"
        popover="auto"
        className="account-menu"
        onToggle={() => {
          setCopied(0);
          setError("");
        }}
      >
        <div className="account-identity">
          <strong className="account-name">{user.name}</strong>
          <div className="account-email-row">
            <span className="account-email">{user.email}</span>
            <button
              type="button"
              className="copy-email"
              aria-label={copied ? "Email copied" : "Copy email"}
              title={copied ? "Copied" : "Copy email"}
              onClick={async () => {
                setError("");

                try {
                  await navigator.clipboard.writeText(user.email);
                  setCopied(Date.now());
                } catch {
                  setError("Could not copy email. Select it to copy manually.");
                }
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {copied ? (
                  <path d="m5 12 4 4L19 6" />
                ) : (
                  <>
                    <rect x="8" y="8" width="12" height="12" rx="2" />
                    <path d="M16 8V4H4v12h4" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
        {!user.emailVerified && (
          <button
            type="button"
            onClick={() => {
              popover.current?.hidePopover();
              verify();
            }}
          >
            Verify email
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            popover.current?.hidePopover();
            settings();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9.5 3-.7 2.3-1.5.9L5 5.7 2.5 10l1.6 1.8v1.7L2.5 15l2.5 4.3 2.3-.5 1.5.9.7 2.3h5l.7-2.3 1.5-.9 2.3.5 2.5-4.3-1.6-1.5v-1.7l1.6-1.8L19 5.7l-2.3.5-1.5-.9-.7-2.3Z" />
            <circle cx="12" cy="12.5" r="3" />
          </svg>
          Settings
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" disabled={busy} onClick={logout}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 4H4v16h5m6-12 4 4-4 4m-7-4h11" />
          </svg>
          {busy ? "Logging out…" : "Log out"}
        </button>
      </div>
    </>
  );
}

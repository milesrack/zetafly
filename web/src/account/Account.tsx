import { useEffect, useRef, useState } from "react";
import { outsideDialog } from "../components/dialog";
import { authClient, type User } from "./auth-client";
import { PasswordInput } from "./PasswordInput";

type Mode = "login" | "signup" | "verify" | "forgot" | "sent" | "reset";

const query = new URLSearchParams(location.search);
const resetRequested = query.get("resetPassword") === "1";
const resetToken = resetRequested ? query.get("token") : null;
const resetLinkError =
  resetRequested && !resetToken
    ? "This reset link is invalid or expired. Request a new one."
    : "";
export const hasPasswordReset = resetRequested;

export function Account({
  open,
  close,
  user,
}: {
  open: boolean;
  close: () => void;
  user: User | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [mode, setMode] = useState<Mode>(
    resetToken ? "reset" : resetRequested ? "forgot" : "login",
  );
  const [email, setEmail] = useState("");
  const [error, setError] = useState(resetLinkError);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendUntil, setResendUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (open) {
      setResent(false);

      if (user && !user.emailVerified) {
        setEmail(user.email);
        setMode("verify");
      }

      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      generation.current++;
      setMode("login");
      setError("");
      setBusy(false);
      setResent(false);
    }
  }, [open, user]);

  useEffect(() => {
    if (
      open &&
      user?.emailVerified &&
      ["login", "signup", "verify"].includes(mode)
    ) {
      close();
    }
  }, [open, user?.emailVerified, mode, close]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching forms must move focus to the new form.
  useEffect(() => {
    if (open) {
      dialog.current
        ?.querySelector<HTMLElement>(
          "input, .account-content button:not(:disabled)",
        )
        ?.focus();
    }
  }, [open, mode]);

  useEffect(() => {
    if (!resendUntil) {
      return;
    }

    const tick = () => {
      const seconds = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
      setRemaining(seconds);

      if (!seconds) {
        setResendUntil(0);
        setResent(false);
      }
    };

    tick();
    const timer = setInterval(tick, 1000);

    return () => clearInterval(timer);
  }, [resendUntil]);

  function cooldown() {
    setRemaining(30);
    setResendUntil(Date.now() + 30000);
  }

  const title = {
    login: "Log in",
    signup: "Create account",
    verify: "Verify your email",
    forgot: "Reset password",
    sent: "Check your email",
    reset: "New password",
  }[mode];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const address = String(data.get("email") ?? email).trim();

    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email: address,
          redirectTo: `${location.origin}/?resetPassword=1`,
        });

        if (request !== generation.current) {
          return;
        }

        if (result.error) {
          throw Error(result.error.message);
        }

        setEmail(address);
        setMode("sent");

        return;
      }

      if (mode === "reset") {
        const result = await authClient.resetPassword({
          newPassword: String(data.get("password")),
          token: resetToken ?? "",
        });

        if (result.error) {
          throw Error(result.error.message);
        }

        await authClient.signOut();
        history.replaceState(null, "", location.pathname);

        if (request === generation.current) {
          setMode("login");
        }

        return;
      }

      const fields = { email: address, password: String(data.get("password")) };
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              ...fields,
              name: String(data.get("name")),
              callbackURL: `${location.origin}/`,
            })
          : await authClient.signIn.email(fields);

      if (request !== generation.current) {
        return;
      }

      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setEmail(address);
          cooldown();
          setMode("verify");

          return;
        }

        throw Error(result.error.message ?? "Unable to log in");
      }

      if (mode === "signup") {
        setEmail(address);
        cooldown();
        setMode("verify");
      } else {
        close();
      }
    } catch (error) {
      if (request === generation.current) {
        setError((error as Error).message);
      }
    } finally {
      if (request === generation.current) {
        setBusy(false);
      }
    }
  }

  async function resend() {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setResent(false);

    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: `${location.origin}/`,
      });

      if (request !== generation.current) {
        return;
      }

      if (result.error) {
        throw Error(result.error.message);
      }

      setResent(true);
      cooldown();
    } catch (error) {
      if (request === generation.current) {
        setError((error as Error).message);
      }
    } finally {
      if (request === generation.current) {
        setBusy(false);
      }
    }
  }

  const failure = error && (
    <p id="account-error" className="form-error" role="alert">
      {error}
    </p>
  );

  return (
    <dialog
      ref={dialog}
      className="account-dialog"
      onCancel={close}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
      onClick={(event) => outsideDialog(event, close)}
      aria-label={title}
    >
      <div className="drawer-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label="Close account"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>
      {mode === "verify" || mode === "sent" ? (
        <div className="account-content">
          <span className="sr-only" role="status">
            {resent ? "Verification email sent." : ""}
          </span>
          <p className="email-confirmation">
            {mode === "verify" ? (
              <>
                Open the verification link sent to <strong>{email}</strong> to
                finish creating your account.
              </>
            ) : (
              <>
                If an account uses <strong>{email}</strong>, you’ll receive a
                password reset link.
              </>
            )}
          </p>
          {failure}
          {mode === "verify" && (
            <button
              type="button"
              className="form-submit"
              disabled={busy || remaining > 0}
              aria-describedby={error ? "account-error" : undefined}
              onClick={resend}
            >
              {busy
                ? "Sending…"
                : remaining > 0
                  ? `Resend in 00:${String(remaining).padStart(2, "0")}`
                  : "Resend email"}
            </button>
          )}
          <button
            type="button"
            className="auth-switch"
            disabled={busy}
            onClick={() => {
              setMode("login");
              setError("");
              setResent(false);
            }}
          >
            Back to log in
          </button>
        </div>
      ) : (
        <form
          key={mode}
          className="account-content"
          onInput={() => {
            if (error) {
              setError("");
            }
          }}
          onSubmit={submit}
        >
          {mode === "signup" && (
            <label>
              Name
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <div className="password-field">
              <div className="password-heading">
                <label htmlFor="account-password">Password</label>
                {mode === "login" && (
                  <button
                    type="button"
                    className="auth-recovery"
                    disabled={busy}
                    onClick={() => {
                      setMode("forgot");
                      setError("");
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <PasswordInput key={String(open)} creating={mode !== "login"} />
            </div>
          )}
          {failure}
          <button
            type="submit"
            className="form-submit"
            disabled={busy}
            aria-describedby={error ? "account-error" : undefined}
          >
            {busy
              ? "Please wait…"
              : {
                  login: "Log in",
                  signup: "Create account",
                  forgot: "Send reset link",
                  reset: "Save password",
                }[mode]}
          </button>
          {mode === "login" || mode === "signup" ? (
            <p className="auth-footer">
              {mode === "login"
                ? "Don’t have an account?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError("");
                }}
              >
                {mode === "login" ? "Sign up" : "Log in"}
              </button>
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="auth-switch"
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Back to log in
            </button>
          )}
        </form>
      )}
    </dialog>
  );
}

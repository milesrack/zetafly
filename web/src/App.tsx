import { useState } from "react";
import { Account, hasPasswordReset } from "./account/Account";
import { AccountMenu } from "./account/AccountMenu";
import { useAccess } from "./account/access";
import { authClient } from "./account/auth-client";
import { SoundButton } from "./audio/PlaybackSound";
import { useSound } from "./audio/useSound";
import { SessionScene } from "./scene/SessionScene";
import { useFlySession } from "./session/useFlySession";
import { Inspector } from "./settings/Inspector";
import { usePreferences } from "./settings/preferences";

const views = ["desk", "keyboard", "screen", "brain"] as const;

export function App() {
  const { data: identity, isPending } = authClient.useSession();
  const user = identity?.user ?? null;
  const verified = Boolean(user?.emailVerified);
  const access = useAccess(verified ? user?.id : undefined);
  const authorisedId = access ? user?.id : undefined;
  const session = useFlySession(authorisedId);
  const preferences = usePreferences(authorisedId);
  const [view, setView] = useState("desk");
  const [sessionOpen, setSessionOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(hasPasswordReset);
  const sound = useSound();
  const { settings, setSettings } = preferences;
  const { state } = session;
  const running = ["loading", "running"].includes(state.status);

  return (
    <main className="app">
      <header className="app-header">
        <h1>zetafly</h1>

        <div className="header-actions">
          <button
            type="button"
            className="run-button"
            title={running ? "Stop the current run" : "Start a new run"}
            disabled={
              session.busy ||
              isPending ||
              Boolean(verified && (!session.connected || !preferences.ready))
            }
            onClick={() =>
              verified
                ? session.act(
                    running ? "stop" : "start",
                    running ? undefined : settings,
                  )
                : setAccountOpen(true)
            }
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              {running ? (
                <rect x="4" y="4" width="8" height="8" />
              ) : (
                <path d="m5 3 8 5-8 5Z" />
              )}
            </svg>
            {running ? "Stop" : "Start"}
          </button>
          <div className="account-action">
            {user ? (
              <AccountMenu
                user={user}
                verify={() => setAccountOpen(true)}
                settings={() => setSessionOpen(true)}
              />
            ) : (
              <button
                type="button"
                className="session-button"
                onClick={() => setAccountOpen(true)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 4h5v16h-5M9 8l4 4-4 4m-5-4h9" />
                </svg>
                Log in
              </button>
            )}
          </div>
        </div>
      </header>
      <section
        className="scene"
        aria-label={view === "brain" ? "Fly brain" : "Fly computer"}
      >
        <SoundButton sound={sound} />
        <div className="view-switcher">
          <div className="view-controls" role="tablist" aria-label="View">
            {views.map((item, index) => (
              <button
                type="button"
                role="tab"
                key={item}
                id={`view-tab-${item}`}
                aria-controls="view-panel"
                aria-selected={view === item}
                tabIndex={view === item ? 0 : -1}
                onClick={() => setView(item)}
                onKeyDown={(event) => {
                  let next: number;

                  switch (event.key) {
                    case "ArrowLeft":
                      next = (index + views.length - 1) % views.length;
                      break;
                    case "ArrowRight":
                      next = (index + 1) % views.length;
                      break;
                    case "Home":
                      next = 0;
                      break;
                    case "End":
                      next = views.length - 1;
                      break;
                    default:
                      return;
                  }

                  event.preventDefault();
                  setView(views[next]);
                  document.getElementById(`view-tab-${views[next]}`)?.focus();
                }}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div
          id="view-panel"
          className="view-panel"
          role="tabpanel"
          aria-labelledby={`view-tab-${view}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The visual tabpanel needs a keyboard focus target.
          tabIndex={0}
        >
          <SessionScene
            key={user?.id}
            sound={sound}
            recordings={session.recordings}
            moments={session.moments}
            state={state}
            png={session.png}
            view={view}
            clockOffset={session.clockOffset}
          />
        </div>
        {session.error && (
          <div className="error-toast" role="alert">
            <span>{session.error}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss error"
              onClick={session.clearError}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
        )}
      </section>
      <Inspector
        key={user?.id ?? "guest"}
        open={sessionOpen}
        close={() => setSessionOpen(false)}
        settings={running ? (state.settings ?? settings) : settings}
        setSettings={setSettings}
        running={running || Boolean(user && !preferences.ready)}
        profiles={preferences.profiles}
        search={preferences.search}
        uploading={preferences.busy}
        upload={preferences.upload}
        remove={preferences.remove}
        downloadDefault={preferences.downloadDefault}
        error={preferences.error}
        signedIn={Boolean(user)}
        sound={sound}
      />
      <Account
        open={accountOpen}
        close={() => setAccountOpen(false)}
        user={user}
      />
    </main>
  );
}

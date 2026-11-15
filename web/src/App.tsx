import { LogIn, Play, Square, X } from "lucide-react";
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
    <main className="app h-dvh flex flex-col">
      <header className="app-header h-15 py-0 px-6 flex items-center gap-10 border-b border-solid border-b-[#e8e9ec] shrink-0">
        <h1>zetafly</h1>

        <div className="header-actions flex items-center ml-auto gap-3">
          <button
            type="button"
            className="run-button flex items-center gap-1.75 bg-[#1b1d22] border border-solid border-[#1b1d22] text-white py-2 px-3.75 rounded-[var(--control-radius)] text-[12px] font-medium"
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
            {running ? (
              <Square aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {running ? "Stop" : "Start"}
          </button>
          <div className="account-action flex items-center">
            {user ? (
              <AccountMenu
                key={user.id}
                user={user}
                verify={() => setAccountOpen(true)}
                settings={() => setSessionOpen(true)}
              />
            ) : (
              <button
                type="button"
                className="session-button inline-flex items-center gap-1.75 border-0 bg-transparent p-2 text-[12px] text-[#626875]"
                onClick={() => setAccountOpen(true)}
              >
                <LogIn aria-hidden="true" />
                Log in
              </button>
            )}
          </div>
        </div>
      </header>
      <section
        className="scene flex-1 min-w-0 min-h-0 relative bg-[#f4f3ef] overflow-hidden"
        aria-label={view === "brain" ? "Fly brain" : "Fly computer"}
      >
        <SoundButton sound={sound} />
        <div className="view-switcher">
          <div
            className="view-controls p-0.75 bg-[#f0f1f4] border border-solid border-[#e8e9ed] rounded-[var(--surface-radius)]"
            role="tablist"
            aria-label="View"
          >
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
          className="view-panel absolute inset-0"
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
              className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
              aria-label="Dismiss error"
              onClick={session.clearError}
            >
              <X aria-hidden="true" />
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

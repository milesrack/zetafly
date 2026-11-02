import { useEffect, useRef } from "react";
import type { RangeKey, Settings } from "../../../shared/contracts.ts";
import type { Sound } from "../audio/useSound";
import { Choice } from "../components/Choice";
import { outsideDialog } from "../components/dialog";
import { RangeInput } from "../components/RangeInput";
import type { Profile, ProfileSearch } from "./preferences";
import { WeightPicker } from "./WeightPicker";
import { WeightUpload } from "./WeightUpload";

const operations = [
  ["add", "Addition"],
  ["sub", "Subtraction"],
  ["mul", "Multiplication"],
  ["div", "Division"],
] as const;

export function Inspector({
  open,
  close,
  settings,
  setSettings,
  running,
  profiles,
  search,
  uploading,
  upload,
  remove,
  downloadDefault,
  error,
  signedIn,
  sound,
}: {
  open: boolean;
  close: () => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  running: boolean;
  profiles: Profile[];
  search: ProfileSearch;
  uploading: boolean;
  upload: (file: File) => void;
  remove: () => void;
  downloadDefault: () => void;
  error: string;
  signedIn: boolean;
  sound: Sound;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [open]);

  const update = (key: RangeKey, value: number) =>
    setSettings({ ...settings, [key]: value });

  return (
    <dialog
      ref={dialog}
      className="inspector"
      onCancel={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
      onClick={(event) => outsideDialog(event, close)}
      aria-label="Settings"
    >
      <div className="drawer-heading">
        <h2>Settings</h2>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label="Close settings"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>
      <div className="settings-content">
        <section className="weights-settings">
          <div className="setting">
            <span>Weights</span>
            {signedIn ? (
              <WeightPicker
                disabled={running || uploading}
                value={settings.profileId}
                onChange={(value) => {
                  const profile = profiles.find(
                    (profile) => profile.id === value,
                  );

                  if (profile) {
                    setSettings({ ...settings, profileId: profile.id });
                  }
                }}
                profiles={profiles}
                search={search}
                container={dialog.current}
              />
            ) : (
              <Choice
                label="Weight profile"
                value="published"
                onChange={() => {}}
                options={[{ value: "published", label: "Default" }]}
                container={dialog.current}
              />
            )}
          </div>
          {signedIn && (
            <>
              <WeightUpload
                disabled={running}
                uploading={uploading}
                upload={upload}
              />
              <div className="weight-actions">
                <button type="button" onClick={downloadDefault}>
                  Download default
                </button>
                {settings.profileId !== "published" && (
                  <button
                    type="button"
                    disabled={running || uploading}
                    onClick={remove}
                  >
                    Remove
                  </button>
                )}
              </div>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <fieldset disabled={running}>
          <legend>Operations</legend>
          <div className="operation-options">
            {operations.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) =>
                    setSettings({ ...settings, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {(["add", "mul"] as const).map((bank) => (
          <fieldset
            key={bank}
            disabled={
              running ||
              !(bank === "add"
                ? settings.add || settings.sub
                : settings.mul || settings.div)
            }
            className="operand-ranges"
          >
            <legend>
              {bank === "add"
                ? "Addition / subtraction"
                : "Multiplication / division"}
            </legend>
            <div className="range-row range-labels">
              <span />
              <span>From</span>
              <span>To</span>
            </div>
            {(["left", "right"] as const).map((side) => (
              <div className="range-row" key={side}>
                <span>{side === "left" ? "Left" : "Right"}</span>
                {(["min", "max"] as const).map((bound) => {
                  const key = `${bank}_${side}_${bound}` as RangeKey;

                  return (
                    <RangeInput
                      key={key}
                      label={`${bank === "add" ? "Addition" : "Multiplication"} ${side} ${bound === "min" ? "minimum" : "maximum"}`}
                      value={settings[key]}
                      onChange={(value) => update(key, value)}
                    />
                  );
                })}
              </div>
            ))}
          </fieldset>
        ))}
        <div className="setting">
          <span>Duration</span>
          <Choice
            label="Duration"
            disabled={running}
            value={String(settings.duration)}
            onChange={(value) =>
              setSettings({ ...settings, duration: Number(value) })
            }
            options={[30, 60, 120, 300, 600].map((s) => ({
              value: String(s),
              label:
                s < 60
                  ? "30 seconds"
                  : `${s / 60} minute${s === 60 ? "" : "s"}`,
            }))}
            container={dialog.current}
          />
        </div>
        <fieldset className="sound-settings">
          <legend>Sound</legend>
          {(["keyboard", "music"] as const).map((key) => (
            <label className="setting" key={key}>
              {key === "keyboard" ? "Keyboard sounds" : "Background music"}
              <input
                type="checkbox"
                role="switch"
                aria-checked={sound[key]}
                checked={sound[key]}
                onChange={(event) => sound.set(key, event.target.checked)}
              />
            </label>
          ))}
        </fieldset>
        <details className="sources">
          <summary>Sources</summary>
          <a href="https://github.com/philshiu/Drosophila_brain_model">
            Shiu et al. — brain model
          </a>
          <a href="https://github.com/flyconnectome/flywire_annotations">
            Schlegel et al. — FlyWire anatomy
          </a>
          <a href="https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600054">
            Kevin MacLeod — Lobby Time
          </a>
          <a href="https://creativecommons.org/licenses/by/4.0/">
            Music licence: CC BY 4.0
          </a>
          <a href="https://github.com/Sudharsanselvaraj/Flylab">
            S Sudharsan — Flylab geometry
          </a>
        </details>
      </div>
    </dialog>
  );
}

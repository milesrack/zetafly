import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RangeKey, Settings } from "../../../shared/contracts.ts";
import { ChangePassword } from "../account/ChangePassword";
import { DeleteAccount } from "../account/DeleteAccount";
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
  const [accountAction, setAccountAction] = useState<
    "password" | "delete" | null
  >(null);

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
    <>
      <dialog
        ref={dialog}
        className="inspector w-97.5 max-w-screen h-dvh max-h-dvh m-[0_0_0_auto] p-0 border-0 border-l border-solid border-l-[#e8e9ec] text-[#18191c] bg-white"
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
        <div className="drawer-heading flex justify-between items-center py-4.5 px-6 border-b border-solid border-b-[#eeeff2]">
          <h2>Settings</h2>
          <button
            type="button"
            className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
            onClick={close}
            aria-label="Close settings"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="settings-content p-[6px_24px_24px]">
          <section className="weights-settings p-[10px_0_22px] border-b border-solid border-b-[#edf0f4]">
            <div className="setting flex items-center justify-between gap-5 text-[12px] py-3.75 px-0">
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
                <div className="weight-actions flex items-center gap-4 mt-1">
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
              <p
                className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
                role="alert"
              >
                {error}
              </p>
            )}
          </section>
          <fieldset disabled={running}>
            <legend>Operations</legend>
            <div className="operation-options grid grid-cols-[1fr_1fr] gap-3.5">
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
              <div className="range-row grid grid-cols-[42px_1fr_1fr] items-center gap-2.5 my-2.25 mx-0 range-labels">
                <span />
                <span>From</span>
                <span>To</span>
              </div>
              {(["left", "right"] as const).map((side) => (
                <div
                  className="range-row grid grid-cols-[42px_1fr_1fr] items-center gap-2.5 my-2.25 mx-0"
                  key={side}
                >
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
          <div className="setting flex items-center justify-between gap-5 text-[12px] py-3.75 px-0">
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
              <label
                className="setting flex items-center justify-between gap-5 text-[12px] py-3.75 px-0"
                key={key}
              >
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
          {signedIn && (
            <fieldset className="account-settings mb-0">
              <legend>Account</legend>
              <div className="account-setting-actions flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="account-setting-action flex-none min-h-7.5 py-1.5 px-2.5 border border-solid border-[#dfe2e7] bg-[#e8eaee] text-[#18191c] text-[12px] leading-[16px]"
                  onClick={() => {
                    close();
                    setAccountAction("password");
                  }}
                >
                  Change password
                </button>
                <button
                  type="button"
                  className="account-setting-action flex-none min-h-7.5 py-1.5 px-2.5 border border-solid border-[#dfe2e7] bg-[#e8eaee] text-[#18191c] text-[12px] leading-[16px] delete-account-button"
                  onClick={() => {
                    close();
                    setAccountAction("delete");
                  }}
                >
                  Delete account
                </button>
              </div>
            </fieldset>
          )}
        </div>
      </dialog>
      {signedIn && accountAction === "delete" && (
        <DeleteAccount close={() => setAccountAction(null)} />
      )}
      {signedIn && accountAction === "password" && (
        <ChangePassword close={() => setAccountAction(null)} />
      )}
    </>
  );
}

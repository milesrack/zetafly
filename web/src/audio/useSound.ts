import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE = "zetafly.sound";

type Preferences = { keyboard: boolean; music: boolean; muted: boolean };

const defaults: Preferences = { keyboard: false, music: true, muted: false };

function stored(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? "null");

    return {
      keyboard: value?.keyboard === true,
      music: typeof value?.music === "boolean" ? value.music : defaults.music,
      muted: value?.muted === true,
    };
  } catch {
    return defaults;
  }
}

class SoundOutput {
  preferences = defaults;
  playing = false;
  context?: AudioContext;
  private clickBuffer?: AudioBuffer;
  private musicBuffer?: AudioBuffer;
  private musicSource?: AudioBufferSourceNode;
  private musicOffset = 0;
  private musicStarted = 0;
  private loading = false;
  private disposed = false;
  private request = new AbortController();

  private changed: (running: boolean) => void;

  constructor(changed: (running: boolean) => void) {
    this.changed = changed;
  }

  activate = () => {
    if (
      this.disposed ||
      this.preferences.muted ||
      (!this.preferences.keyboard && !this.preferences.music)
    ) {
      return;
    }

    try {
      if (!this.context) {
        this.context = new AudioContext();

        this.context.onstatechange = () => {
          if (!this.disposed) {
            this.changed(this.context?.state === "running");
            this.sync();
          }
        };

        this.changed(this.context.state === "running");
      }

      void this.context
        .resume()
        .then(() => {
          if (!this.disposed) {
            this.changed(this.context?.state === "running");
            this.sync();
          }
        })
        .catch(() => {});

      if (this.preferences.music && !this.musicBuffer && !this.loading) {
        this.loading = true;

        void fetch("/audio/lobby-time.mp3", {
          signal: this.request.signal,
        })
          .then((response) => {
            if (!response.ok) {
              throw Error("Music unavailable");
            }

            return response.arrayBuffer();
          })
          .then((data) => this.context!.decodeAudioData(data))
          .then((buffer) => {
            if (!this.disposed) {
              this.musicBuffer = buffer;
              this.sync();
            }
          })
          .catch(() => {})
          .finally(() => {
            this.loading = false;
          });
      }
    } catch {}
  };

  sync = () => {
    const context = this.context;
    const active = !this.preferences.muted;

    if (
      active &&
      this.preferences.music &&
      context?.state === "running" &&
      this.musicBuffer &&
      !this.musicSource
    ) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = this.musicBuffer;
      source.loop = true;
      gain.gain.value = 0.15;
      source.connect(gain).connect(context.destination);

      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };

      this.musicStarted = context.currentTime;
      source.start(0, this.musicOffset % this.musicBuffer.duration);
      this.musicSource = source;
    } else if ((!active || !this.preferences.music) && this.musicSource) {
      this.musicOffset += context!.currentTime - this.musicStarted;
      this.musicSource.stop();
      this.musicSource = undefined;
    }
  };

  keypress = () => {
    const context = this.context;

    if (
      !this.playing ||
      document.hidden ||
      this.preferences.muted ||
      !this.preferences.keyboard ||
      context?.state !== "running"
    ) {
      return;
    }

    if (!this.clickBuffer) {
      this.clickBuffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 0.025),
        context.sampleRate,
      );

      const samples = this.clickBuffer.getChannelData(0);

      for (let i = 0; i < samples.length; i++) {
        samples[i] =
          (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.004));
      }
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.clickBuffer;
    filter.type = "bandpass";
    filter.frequency.value = 1700;
    filter.Q.value = 0.7;
    gain.gain.value = 0.28;
    source.connect(filter).connect(gain).connect(context.destination);

    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };

    source.start();
  };

  dispose = () => {
    this.disposed = true;
    this.request.abort();
    this.musicSource?.stop();
    this.musicSource = undefined;

    if (this.context) {
      this.context.onstatechange = null;
    }

    void this.context?.close().catch(() => {});
  };
}

export function useSound() {
  const [preferences, setPreferences] = useState(stored);
  const output = useRef<SoundOutput | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sound = new SoundOutput(setReady);
    output.current = sound;

    const activate = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".sound-button")
      ) {
        sound.activate();
      }
    };
    const visibility = () => {
      if (!document.hidden) {
        sound.activate();
      }

      sound.sync();
    };

    document.addEventListener("pointerdown", activate);
    document.addEventListener("keydown", activate);
    document.addEventListener("visibilitychange", visibility);

    return () => {
      document.removeEventListener("pointerdown", activate);
      document.removeEventListener("keydown", activate);
      document.removeEventListener("visibilitychange", visibility);
      sound.dispose();
      output.current = null;
    };
  }, []);

  useEffect(() => {
    if (output.current) {
      output.current.preferences = preferences;
      output.current.activate();
      output.current.sync();
    }
  }, [preferences]);

  const update = (next: Preferences) => {
    setPreferences(next);

    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
    } catch {}

    if (output.current) {
      output.current.preferences = next;
      output.current.activate();
      output.current.sync();
    }
  };
  const playback = useCallback((playing: boolean) => {
    if (output.current) {
      output.current.playing = playing;
      output.current.sync();
    }
  }, []);
  const keypress = useCallback(() => output.current?.keypress(), []);

  return {
    ...preferences,
    blocked:
      (preferences.keyboard || preferences.music) &&
      !preferences.muted &&
      !ready,
    activate: () => output.current?.activate(),
    enabled: (preferences.keyboard || preferences.music) && !preferences.muted,
    set: (key: "keyboard" | "music", value: boolean) =>
      update({
        ...preferences,
        [key]: value,
        muted: value ? false : preferences.muted,
      }),
    toggle: () =>
      update(
        preferences.keyboard || preferences.music
          ? { ...preferences, muted: !preferences.muted }
          : { ...preferences, keyboard: true, muted: false },
      ),
    keypress,
    playback,
  };
}

export type Sound = ReturnType<typeof useSound>;

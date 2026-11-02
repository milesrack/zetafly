import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile as WeightProfile } from "../../../shared/contracts.ts";
import { DEFAULT_SETTINGS } from "../../../shared/settings.ts";
import { apiFetch, request } from "../api";

export type Profile = Pick<WeightProfile, "id" | "name" | "arithmeticMode">;

export type ProfileSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<Profile[]>;

const defaults: Profile[] = [
  { id: "published", name: "Default", arithmeticMode: "sequence" },
];

export function usePreferences(userId?: string) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [profiles, setProfiles] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef<string | undefined>(undefined);
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    let disposed = false;
    loaded.current = undefined;
    saving.current = Promise.resolve();
    setReady(false);
    setBusy(false);
    setError("");
    setProfiles(defaults);
    setSettings(DEFAULT_SETTINGS);

    if (userId) {
      Promise.all([
        apiFetch("/api/preferences").then((r) => {
          if (!r.ok) {
            throw Error("Settings unavailable");
          }

          return r.json();
        }),
        apiFetch("/api/weights").then((r) => {
          if (!r.ok) {
            throw Error("Weights unavailable");
          }

          return r.json();
        }),
      ])
        .then(([settings, profiles]) => {
          if (!disposed) {
            setSettings(settings);
            setProfiles(profiles);
            loaded.current = userId;
            setReady(true);
          }
        })
        .catch((error) => !disposed && setError(error.message));
    }

    return () => {
      disposed = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !ready || loaded.current !== userId) {
      return;
    }

    let disposed = false;
    const timer = setTimeout(() => {
      saving.current = saving.current.then(async () => {
        if (disposed || loaded.current !== userId) {
          return;
        }

        try {
          await request("preferences", settings, "PUT");

          if (!disposed && loaded.current === userId) {
            setError("");
          }
        } catch (error) {
          if (!disposed && loaded.current === userId) {
            setError((error as Error).message);
          }
        }
      });
    }, 500);

    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [settings, userId, ready]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A new account must cancel and restart the picker search to isolate results.
  const search = useCallback<ProfileSearch>(
    async (query, signal) => {
      const response = await apiFetch(
        `/api/weights?q=${encodeURIComponent(query)}`,
        { signal },
      );

      if (!response.ok) {
        throw Error("Weights unavailable");
      }

      return response.json();
    },
    [userId],
  );

  async function upload(file: File) {
    setBusy(true);
    setError("");

    try {
      if (file.size > 64 * 1024 ** 2) {
        throw Error("Weights must be smaller than 64 MB");
      }

      const response = await apiFetch("/api/weights", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      const profile = await response.json();

      if (!response.ok) {
        throw Error(profile.error);
      }

      if (loaded.current !== userId) {
        return;
      }

      setProfiles((previous) => [...previous, profile]);
      setSettings((previous) => ({ ...previous, profileId: profile.id }));
    } catch (error) {
      if (loaded.current === userId) {
        setError((error as Error).message);
      }
    } finally {
      if (loaded.current === userId) {
        setBusy(false);
      }
    }
  }

  async function remove() {
    setBusy(true);
    setError("");

    try {
      await request(`weights/${settings.profileId}`, undefined, "DELETE");

      if (loaded.current !== userId) {
        return;
      }

      setProfiles((previous) =>
        previous.filter((profile) => profile.id !== settings.profileId),
      );

      setSettings((previous) => ({ ...previous, profileId: "published" }));
    } catch (error) {
      if (loaded.current === userId) {
        setError((error as Error).message);
      }
    } finally {
      if (loaded.current === userId) {
        setBusy(false);
      }
    }
  }

  async function downloadDefault() {
    setError("");

    try {
      const response = await apiFetch("/api/weights/published/file");

      if (!response.ok) {
        throw Error("Default weights unavailable");
      }

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "zetafly-default.npz";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Default weights unavailable");
    }
  }

  return {
    settings,
    setSettings,
    profiles: loaded.current === userId ? profiles : defaults,
    search,
    ready,
    busy,
    error,
    upload,
    remove,
    downloadDefault,
  };
}

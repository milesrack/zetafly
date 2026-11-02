import { useEffect, useState } from "react";
import { renewAccess } from "../api";

export function useAccess(userId?: string) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    setReady(false);

    if (!userId) {
      return;
    }

    const renew = () =>
      renewAccess()
        .then((ok) => {
          if (!disposed) {
            setReady(ok);
          }
        })
        .catch(() => !disposed && setReady(false));

    renew();
    const timer = setInterval(renew, 240000);
    const focus = () => {
      if (document.visibilityState === "visible") {
        renew();
      }
    };

    document.addEventListener("visibilitychange", focus);

    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [userId]);

  return ready;
}

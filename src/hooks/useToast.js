// useToast — small wrapper around a message state that auto-clears
// after a delay. Used by the global <Toast /> component.

import { useCallback, useEffect, useState } from "react";

export function useToast({ defaultDurationMs = 2200 } = {}) {
  const [message, setMessage] = useState("");

  const show = useCallback((text) => {
    setMessage(text);
  }, []);

  const dismiss = useCallback(() => {
    setMessage("");
  }, []);

  // Auto-dismiss is implemented inside the <Toast/> component, but we
  // also clear here on unmount so a fast route change doesn't leave a
  // stale message.
  useEffect(() => () => setMessage(""), []);

  return { message, show, dismiss, defaultDurationMs };
}

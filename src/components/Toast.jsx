import { useEffect, useRef, useState } from "react";
import { Save, X } from "lucide-react";

/**
 * Accessible toast: aria-live="polite" so screen readers announce new
 * messages, with a dismiss button and an auto-dismiss timer.
 *
 * @param {object} props
 * @param {string} props.message
 * @param {number} [props.durationMs]
 * @param {() => void} props.onDismiss
 */
export default function Toast({ message, durationMs = 2200, onDismiss }) {
  const [visible, setVisible] = useState(Boolean(message));
  const timerRef = useRef(null);

  useEffect(() => {
    setVisible(Boolean(message));
    if (!message) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [message, durationMs, onDismiss]);

  if (!visible || !message) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <Save size={16} />
      <span>{message}</span>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
          onDismiss?.();
        }}
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  );
}

import { LoaderCircle } from "lucide-react";

/**
 * Small accessible spinner. Use label="" to render icon-only.
 *
 * @param {object} props
 * @param {string} [props.label]
 * @param {"sm" | "md" | "lg"} [props.size]
 */
export default function LoadingSpinner({ label = "Loading", size = "md" }) {
  const sizePx = size === "sm" ? 14 : size === "lg" ? 24 : 18;
  return (
    <span className={`loading-spinner loading-spinner-${size}`} role="status">
      <LoaderCircle size={sizePx} className="spin-icon" aria-hidden="true" />
      {label ? <span className="visually-hidden">{label}</span> : null}
    </span>
  );
}

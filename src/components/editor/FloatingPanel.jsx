import { Copy, Trash2, Type } from "lucide-react";

/**
 * The contextual floating action bar that appears when one or more
 * elements are selected.
 */
export default function FloatingPanel({
  count,
  strokeColor,
  onColorChange,
  onEditText,
  onDuplicate,
  onDelete,
  canEditText
}) {
  if (count === 0) return null;
  return (
    <div className="floating-panel" role="toolbar" aria-label="Selection actions">
      <span className="selection-count">{count}</span>
      <input
        className="color-input"
        type="color"
        value={strokeColor || "#111111"}
        onChange={(event) => onColorChange(event.target.value)}
        aria-label="Selected stroke color"
      />
      <button
        type="button"
        onClick={onEditText}
        disabled={!canEditText}
        title="Edit text"
        aria-label="Edit text"
      >
        <Type size={18} />
      </button>
      <button type="button" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate">
        <Copy size={18} />
      </button>
      <button type="button" onClick={onDelete} title="Delete" aria-label="Delete">
        <Trash2 size={18} />
      </button>
    </div>
  );
}

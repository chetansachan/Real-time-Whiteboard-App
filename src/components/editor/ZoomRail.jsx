import { Eye, Shapes, ZoomIn, ZoomOut } from "lucide-react";

export default function ZoomRail({ zoom, onZoomIn, onZoomOut, onReset, onTogglePanel }) {
  return (
    <aside className="zoom-rail" aria-label="View controls">
      <button
        type="button"
        onClick={onTogglePanel}
        title="Toggle panel"
        aria-label="Toggle panel"
      >
        <Eye size={19} />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <ZoomIn size={19} />
      </button>
      <span aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <ZoomOut size={19} />
      </button>
      <button
        type="button"
        onClick={onReset}
        title="Reset view"
        aria-label="Reset view"
      >
        <Shapes size={19} />
      </button>
    </aside>
  );
}

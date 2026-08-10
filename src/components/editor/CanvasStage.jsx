import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { renderElement, renderSelectionBox } from "../../utils/canvasRenderer.js";

/**
 * The drawing surface + live-sync chip. The redraw loop lives here so
 * the BoardEditor page doesn't have to thread viewport/element refs
 * through every render.
 */
export default function CanvasStage({
  canvasRef,
  boardWrapRef,
  elements,
  preview,
  selectionBox,
  selectedIds,
  viewport,
  wsStatus,
  boardTitle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel
}) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = boardWrapRef.current;
    if (!canvas || !wrap) return undefined;

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.translate(viewport.x, viewport.y);
      ctx.scale(viewport.zoom, viewport.zoom);
      elements.forEach((element) => renderElement(ctx, element, selectedIds.includes(element.id)));
      if (preview) renderElement(ctx, preview, false);
      if (selectionBox) renderSelectionBox(ctx, selectionBox);
      ctx.restore();
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };

    schedule();
    const onResize = () => schedule();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [canvasRef, boardWrapRef, elements, preview, selectionBox, selectedIds, viewport]);

  const isConnected = wsStatus === "connected";
  const isConnecting = wsStatus === "connecting" || wsStatus === "reconnecting";
  const isFailed = wsStatus === "failed";

  return (
    <div className="canvas-wrap" ref={boardWrapRef} onWheel={onWheel}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Collaborative whiteboard canvas"
      />
      <div className={`connection-chip ${isConnected ? "connected" : isFailed ? "failed" : "connecting"}`}>
        <LoaderCircle size={15} className={isConnected ? "pulse-icon" : "spin-icon"} />
        <span>
          {isConnected
            ? `Live Sync: ${boardTitle || "Connected"}`
            : isFailed
              ? "Connection failed"
              : isConnecting
                ? "Connecting WebSocket..."
                : "Offline Board"}
        </span>
      </div>
    </div>
  );
}

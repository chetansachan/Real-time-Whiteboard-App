import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopBar from "../components/editor/TopBar.jsx";
import EditorToolbar from "../components/editor/EditorToolbar.jsx";
import StylePanel from "../components/editor/StylePanel.jsx";
import PageStrip from "../components/editor/PageStrip.jsx";
import ZoomRail from "../components/editor/ZoomRail.jsx";
import CollabPanel from "../components/editor/CollabPanel.jsx";
import FloatingPanel from "../components/editor/FloatingPanel.jsx";
import CanvasStage from "../components/editor/CanvasStage.jsx";
import { useWhiteboardController } from "../hooks/useWhiteboardController.js";

/**
 * The full-screen board editor. All state and event handlers live in
 * useWhiteboardController; this component is responsible for layout,
 * global keyboard shortcuts, and wiring the controller to UI.
 */
export default function BoardEditor({ boardId, showToast }) {
  const navigate = useNavigate();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  const ctrl = useWhiteboardController({
    boardId,
    enabled: Boolean(boardId),
    onToast: showToast
  });
  const {
    state,
    elements,
    selectedElements,
    primarySelection,
    preview,
    selectionBox,
    undoStack,
    redoStack,
    chatText,
    canvasRef,
    boardWrapRef,
    savedAt,
    boardApi,
    ws,
    actions
  } = ctrl;

  const invite = useCallback(async () => {
    const url = `${window.location.origin}/board/${state.board?.boardId || ""}?room=${encodeURIComponent(
      state.board?.room?.name || ""
    )}`;
    try {
      await navigator.clipboard?.writeText(url);
      showToast?.("Invite link copied");
    } catch {
      showToast?.("Could not copy invite link");
    }
  }, [state.board?.boardId, state.board?.room?.name, showToast]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const cmd = event.ctrlKey || event.metaKey;
      if (cmd && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
      } else if (cmd && event.key.toLowerCase() === "y") {
        event.preventDefault();
        actions.redo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (state.selectedIds.length) {
          event.preventDefault();
          actions.deleteSelected();
        }
      } else if (event.key === "+" || event.key === "=") {
        actions.zoomBy(0.1);
      } else if (event.key === "-" || event.key === "_") {
        actions.zoomBy(-0.1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, state.selectedIds.length]);

  const handleGoHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleLeave = useCallback(() => {
    actions.handleLeaveRoom();
    showToast?.("Left board");
    navigate("/");
  }, [actions, navigate, showToast]);

  const handleJoinRoom = useCallback(
    (e) => {
      e.preventDefault();
      actions.handleJoinRoom();
      showToast?.("Joined room");
    },
    [actions, showToast]
  );

  const handleSendChat = useCallback(
    (text) => {
      actions.sendChat(text);
    },
    [actions]
  );

  const canEditText =
    selectedElements.length === 1 && ["text", "sticky"].includes(primarySelection?.type);

  return (
    <div className="app-shell">
      <TopBar
        boardTitle={state.board?.title || ""}
        savedAt={savedAt}
        onTitleChange={actions.updateTitle}
        onTitleSave={actions.saveTitle}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onExport={actions.exportBoard}
        onInvite={invite}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        apiStatus={boardApi.status}
        apiError={boardApi.error}
        onHome={handleGoHome}
        userName={state.board?.room?.userName}
      />

      <EditorToolbar
        tool={state.tool}
        setTool={actions.setTool}
        onClearPage={actions.clearBoard}
      />

      <main className="board-stage">
        <CanvasStage
          canvasRef={canvasRef}
          boardWrapRef={boardWrapRef}
          elements={elements}
          preview={preview}
          selectionBox={selectionBox}
          selectedIds={state.selectedIds}
          viewport={state.viewport}
          wsStatus={ws.status}
          boardTitle={state.board?.title}
          onPointerDown={actions.handlePointerDown}
          onPointerMove={actions.handlePointerMove}
          onPointerUp={actions.handlePointerUp}
          onWheel={actions.handleWheel}
        />
      </main>

      <ZoomRail
        zoom={state.viewport.zoom}
        onZoomIn={() => actions.zoomBy(0.1)}
        onZoomOut={() => actions.zoomBy(-0.1)}
        onReset={actions.resetViewport}
        onTogglePanel={() => setIsRightPanelOpen((v) => !v)}
      />

      <FloatingPanel
        count={selectedElements.length}
        strokeColor={primarySelection?.color}
        onColorChange={actions.updateSelectedColor}
        onEditText={actions.editSelectedText}
        onDuplicate={actions.duplicateSelected}
        onDelete={actions.deleteSelected}
        canEditText={canEditText}
      />

      <StylePanel
        tool={state.tool}
        color={state.color}
        setColor={actions.setColor}
        fillColor={state.fillColor}
        setFillColor={actions.setFillColor}
        brushSize={state.brushSize}
        setBrushSize={actions.setBrushSize}
        selectedElements={selectedElements}
        updateSelectedColor={actions.updateSelectedColor}
        updateSelectedFill={actions.updateSelectedFill}
      />

      <PageStrip
        pages={state.board?.pages || []}
        activePageId={state.board?.activePageId}
        onSelect={actions.setActivePage}
        onAdd={actions.addPage}
      />

      <CollabPanel
        room={state.board?.room}
        chat={state.board?.chat || []}
        isOpen={isRightPanelOpen}
        onClose={() => setIsRightPanelOpen(false)}
        roomForm={state.roomForm}
        setRoomForm={actions.setRoomForm}
        onJoin={handleJoinRoom}
        onLeave={handleLeave}
        chatText={chatText}
        setChatText={actions.setChatText}
        onSendChat={handleSendChat}
      />
    </div>
  );
}

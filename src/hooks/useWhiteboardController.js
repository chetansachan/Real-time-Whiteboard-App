// useWhiteboardController owns all of the canvas, selection, undo/redo,
// and tool state for a single open board. It is consumed by the
// BoardEditor page and exposes a stable, callback-based surface so the
// editor doesn't have to know about the board data model.
//
// Hot-path state (preview, selection box) stays in local refs so the
// 60fps pointer move path doesn't fight React's render loop.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  addUserElement,
  canChat,
  createId,
  createShapeElement,
  deleteElements,
  duplicateElements,
  getActivePage,
  getElementsInBox,
  isPointInElement,
  joinRoom,
  leaveRoom,
  mergeRemoteBoardMetadata,
  moveElements,
  pickTopElementId,
  toggleSelection,
  updateActivePageElements,
  updateElementsFill,
  updateElementsStroke
} from "../utils/whiteboard.js";
import { useBoardApi } from "./useBoardApi.js";
import { useBoardWebSocket } from "./useBoardWebSocket.js";
import { usePersistentBoard } from "./usePersistentBoard.js";
import { exportBoardPng } from "../utils/export.js";
import { savePageElements } from "../services/boardApi.js";

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialCanvasState = {
  board: null,
  selectedIds: [],
  tool: "pen",
  color: "#111111",
  fillColor: "transparent",
  brushSize: 5,
  viewport: { x: 60, y: 72, zoom: 1 },
  roomForm: { roomName: "", userName: "" }
};

/**
 * Reducer used for the durable board state. Local-only state
 * (preview, undo/redo stacks, selection box) lives outside the
 * reducer so we don't churn through it on every pointer move.
 */
function canvasReducer(state, action) {
  switch (action.type) {
    case "REPLACE_BOARD": {
      // Merge with the rest of the canvas state so we don't lose
      // tool/color/etc when a remote board arrives.
      return { ...state, board: action.board };
    }
    case "MERGE_REMOTE_BOARD": {
      const merged = mergeRemoteBoardMetadata(state.board, action.board);
      return { ...state, board: merged };
    }
    case "SET_BOARD": {
      // Used by the WS handler when an inbound message needs to mutate
      // the current page's elements.
      return { ...state, board: action.updater(state.board) };
    }
    case "SET_ACTIVE_PAGE": {
      return { ...state, board: { ...state.board, activePageId: action.pageId }, selectedIds: [] };
    }
    case "ADD_PAGE": {
      return { ...state, board: { ...state.board, ...action.board } };
    }
    case "SET_TOOL":
      return { ...state, tool: action.tool, selectedIds: [] };
    case "SET_COLOR":
      return { ...state, color: action.color };
    case "SET_FILL_COLOR":
      return { ...state, fillColor: action.fillColor };
    case "SET_BRUSH_SIZE":
      return { ...state, brushSize: action.brushSize };
    case "SET_VIEWPORT":
      return { ...state, viewport: action.viewport };
    case "SET_ROOM_FORM":
      return { ...state, roomForm: { ...state.roomForm, ...action.patch } };
    case "JOIN_ROOM":
      return { ...state, board: { ...state.board, ...action.board } };
    case "LEAVE_ROOM":
      return { ...state, board: { ...state.board, ...action.board }, selectedIds: [] };
    case "ADD_CHAT_MESSAGE":
      return { ...state, board: { ...state.board, chat: [...state.board.chat, action.message] } };
    case "SET_SELECTED_IDS":
      return { ...state, selectedIds: action.ids };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string|null} options.boardId  - currently open board id (or null on the dashboard)
 * @param {boolean} options.enabled     - whether to actually open the board
 * @param {(msg: string) => void} [options.onToast]  - toast surface
 */
export function useWhiteboardController({ boardId, enabled, onToast }) {
  const [board, , savedAt] = usePersistentBoard(boardId);
  const [state, dispatch] = useReducer(canvasReducer, {
    ...initialCanvasState,
    board,
    roomForm: { roomName: board.room.name, userName: board.room.userName }
  });

  // Whenever the reducer's board changes, persist it to localStorage.
  // We use a ref to track the last persisted JSON so we skip no-op writes.
  // This avoids any state update (and re-render) on the persistence path.
  const lastBoardJsonRef = useRef("");
  useEffect(() => {
    if (!state.board) return;
    const json = JSON.stringify(state.board);
    if (json === lastBoardJsonRef.current) return;
    lastBoardJsonRef.current = json;
    // Write directly to localStorage — do NOT call setBoard() here;
    // that would trigger a usePersistentBoard state update → re-render loop.
    try {
      const key = `whiteboard_board_${state.board.boardId || "default"}`;
      localStorage.setItem(key, json);
    } catch {
      // ignore
    }
  }, [state.board]);

  // --- Local-only state (high frequency) ----------------------------------
  const [preview, setPreview] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [chatText, setChatText] = useState("");

  // --- Refs for hot-path data --------------------------------------------
  const canvasRef = useRef(null);
  const boardWrapRef = useRef(null);
  const dragRef = useRef(null);

  // Keep latest selectedIds/elements/activePage in refs so handlers
  // and the WS callback always see the freshest values without forcing
  // the connection effect to re-run.
  const elements = useMemo(
    () => getActivePage(state.board)?.elements || [],
    [state.board]
  );
  const elementsRef = useRef(elements);
  const selectedIdsRef = useRef(state.selectedIds);
  const activePageIdRef = useRef(state.board?.activePageId);
  const toolRef = useRef(state.tool);
  const colorRef = useRef(state.color);
  const fillRef = useRef(state.fillColor);
  const brushRef = useRef(state.brushSize);
  const viewportRef = useRef(state.viewport);
  const userNameRef = useRef(state.board?.room?.userName);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);
  useEffect(() => {
    selectedIdsRef.current = state.selectedIds;
  }, [state.selectedIds]);
  useEffect(() => {
    activePageIdRef.current = state.board?.activePageId;
  }, [state.board?.activePageId]);
  useEffect(() => {
    toolRef.current = state.tool;
  }, [state.tool]);
  useEffect(() => {
    colorRef.current = state.color;
  }, [state.color]);
  useEffect(() => {
    fillRef.current = state.fillColor;
  }, [state.fillColor]);
  useEffect(() => {
    brushRef.current = state.brushSize;
  }, [state.brushSize]);
  useEffect(() => {
    viewportRef.current = state.viewport;
  }, [state.viewport]);
  useEffect(() => {
    userNameRef.current = state.board?.room?.userName;
  }, [state.board?.room?.userName]);

  // --- Networking --------------------------------------------------------
  // Wrap dispatch in a stable ref-based callback so useBoardApi doesn't
  // get a new function reference on every render (which would make the
  // boardQuery useEffect fire in a loop).
  const dispatchSetBoardRef = useRef(null);
  dispatchSetBoardRef.current = (updater) => dispatch({ type: "SET_BOARD", updater });
  const stableSetBoard = useCallback((updater) => dispatchSetBoardRef.current(updater), []);

  const boardApi = useBoardApi({
    boardId,
    board: state.board,
    enabled,
    setBoard: stableSetBoard,
    setToast: onToast
  });

  const handleWsMessage = useCallback(
    (msg) => {
      if (!msg) return;
      let data = msg;
      if (msg.payload) {
        if (typeof msg.payload === "string") {
          try {
            data = JSON.parse(msg.payload);
          } catch {
            data = msg;
          }
        } else if (typeof msg.payload === "object") {
          data = msg.payload;
        }
      }
      const type = data.type || msg.type;
      if (type === "chat" && data.text && data.author) {
        dispatch({
          type: "ADD_CHAT_MESSAGE",
          message: {
            id: createId("chat"),
            author: data.author,
            text: data.text,
            time: "now"
          }
        });
      } else if (["elements", "draw", "move", "delete", "clear"].includes(type)) {
        dispatch({
          type: "SET_BOARD",
          updater: (current) => {
            const targetPageId = data.pageId || current.activePageId;
            const updatedPages = current.pages.map((page) => {
              const isTarget =
                page.id === targetPageId || page.pageId === targetPageId || current.pages.length === 1;
              if (!isTarget) return page;

              let nextElements = page.elements;
              if (type === "draw" && data.element) {
                const exists = page.elements.some((el) => el.id === data.element.id);
                nextElements = exists
                  ? page.elements.map((el) => (el.id === data.element.id ? data.element : el))
                  : [...page.elements.filter((el) => !el.isTemplate), data.element];
              } else if (type === "clear") {
                nextElements = [];
              } else if (type === "delete" && Array.isArray(data.elementIds)) {
                const deleteSet = new Set(data.elementIds);
                nextElements = page.elements.filter((el) => !deleteSet.has(el.id));
              } else if (Array.isArray(data.elements)) {
                nextElements = data.elements.filter((el) => !el.isTemplate);
              }
              return { ...page, elements: nextElements };
            });
            return { ...current, pages: updatedPages };
          }
        });
      }
    },
    []
  );

  const ws = useBoardWebSocket({
    boardId: state.board?.boardId,
    enabled: enabled && Boolean(state.board?.boardId),
    initialCursor: state.board?.cursor || 0,
    onMessage: handleWsMessage
  });
  // Keep ws in a ref so pointer handlers can call sendMessage without
  // capturing it in their dependency arrays.
  const wsRef = useRef(ws);
  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  // --- Actions -----------------------------------------------------------

  const pushUndo = useCallback((currentElements) => {
    setUndoStack((stack) => [...stack.slice(-29), currentElements]);
    setRedoStack([]);
  }, []);

  const boardIdRef = useRef(state.board?.boardId);
  useEffect(() => {
    boardIdRef.current = state.board?.boardId;
  }, [state.board?.boardId]);

  const commitElements = useCallback(
    (nextElements, { markUserContent = true } = {}) => {
      const current = elementsRef.current;
      pushUndo(current);
      dispatch({
        type: "SET_BOARD",
        updater: (b) => updateActivePageElements(b, nextElements, markUserContent ? true : b.hasUserContent)
      });
      ws.sendMessage({
        type: "elements",
        pageId: activePageIdRef.current,
        elements: nextElements,
        sender: userNameRef.current
      });
      // Also persist via REST so the save is durable even if the WS goroutine
      // races with a reconnect (e.g. the user erases everything and leaves quickly).
      const bid = boardIdRef.current;
      const pid = activePageIdRef.current;
      if (bid && pid) {
        savePageElements(bid, pid, nextElements).catch(() => {
          // Best-effort — WS path is the primary channel, REST is the safety net.
        });
      }
    },
    [pushUndo, ws]
  );

  const addElementToBoard = useCallback(
    (element) => {
      const current = elementsRef.current;
      pushUndo(current);
      let nextPageId = null;
      dispatch({
        type: "SET_BOARD",
        updater: (b) => {
          const next = addUserElement(b, element);
          nextPageId = getActivePage(next)?.id;
          return next;
        }
      });
      // Defer the WS broadcast until after the state update has
      // flushed so we send the freshest element list, not the
      // pre-update one.
      queueMicrotask(() => {
        const fresh = elementsRef.current;
        ws.sendMessage({
          type: "elements",
          pageId: nextPageId,
          elements: fresh,
          sender: userNameRef.current
        });
      });
      dispatch({ type: "SET_SELECTED_IDS", ids: [element.id] });
    },
    [pushUndo, ws]
  );

  const addTextAt = useCallback(
    (point) => {
      const text = window.prompt("Text", "Add your idea");
      if (!text) return;
      addElementToBoard({
        id: createId("text"),
        type: "text",
        x: point.x,
        y: point.y,
        text,
        color: colorRef.current,
        size: Math.max(16, brushRef.current + 13),
        width: 260
      });
    },
    [addElementToBoard]
  );

  const addStickyAt = useCallback(
    (point) => {
      const text = window.prompt("Sticky note", "Write a quick note");
      if (!text) return;
      addElementToBoard({
        id: createId("sticky"),
        type: "sticky",
        x: point.x,
        y: point.y,
        width: 260,
        height: 150,
        text,
        color: "#d9a441",
        fill: fillRef.current === "transparent" ? "#fef3c7" : fillRef.current,
        textColor: "#111111"
      });
    },
    [addElementToBoard]
  );

  const eraseAt = useCallback(
    (point) => {
      const current = elementsRef.current;
      const erased = current.filter((element) => isPointInElement(point, element));
      if (!erased.length) return;
      const next = current.filter((element) => !isPointInElement(point, element));
      // Use commitElements so we get:
      //  1. undo stack push
      //  2. an authoritative "elements" WS broadcast — the backend persists
      //     the full remaining list, so no race with prior "draw" messages.
      commitElements(next);
      dispatch({ type: "SET_SELECTED_IDS", ids: [] });
    },
    [commitElements]
  );

  const screenToWorld = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const vp = viewportRef.current;
    return {
      x: (clientX - rect.left - vp.x) / vp.zoom,
      y: (clientY - rect.top - vp.y) / vp.zoom
    };
  }, []);

  const handlePointerDown = useCallback(
    (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = screenToWorld(event.clientX, event.clientY);
      const tool = toolRef.current;

      if (tool === "pan" || event.button === 1 || event.altKey) {
        dragRef.current = {
          kind: "pan",
          startX: event.clientX,
          startY: event.clientY,
          viewport: viewportRef.current
        };
        return;
      }
      if (tool === "text") return addTextAt(point);
      if (tool === "sticky") return addStickyAt(point);
      if (tool === "eraser") {
        eraseAt(point);
        dragRef.current = { kind: "erase" };
        return;
      }
      if (tool === "select") {
        const hitId = pickTopElementId(elementsRef.current, point);
        if (hitId) {
          const nextSelectedIds = event.shiftKey
            ? toggleSelection(selectedIdsRef.current, hitId)
            : selectedIdsRef.current.includes(hitId)
              ? selectedIdsRef.current
              : [hitId];
          dispatch({ type: "SET_SELECTED_IDS", ids: nextSelectedIds });
          dragRef.current = {
            kind: "move",
            selectedIds: nextSelectedIds,
            start: point,
            startElements: elementsRef.current
          };
        } else {
          const baseSelectedIds = event.shiftKey ? selectedIdsRef.current : [];
          dispatch({ type: "SET_SELECTED_IDS", ids: baseSelectedIds });
          dragRef.current = {
            kind: "marquee",
            additive: event.shiftKey,
            start: point,
            startSelectedIds: baseSelectedIds
          };
          setSelectionBox({ x: point.x, y: point.y, width: 1, height: 1 });
        }
        return;
      }
      if (tool === "pen") {
        const element = {
          id: createId("stroke"),
          type: "stroke",
          points: [[point.x, point.y, event.pressure || 0.5]],
          color: colorRef.current,
          size: brushRef.current
        };
        setPreview(element);
        dragRef.current = { kind: "draw", element };
        return;
      }
      if (["line", "arrow", "rect", "ellipse"].includes(tool)) {
        const element = createShapeElement({
          tool,
          point,
          color: colorRef.current,
          fill: fillRef.current,
          brushSize: brushRef.current
        });
        setPreview(element);
        dragRef.current = { kind: "shape", element, start: point };
      }
    },
    [addTextAt, addStickyAt, eraseAt, screenToWorld]
  );

  const handlePointerMove = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = screenToWorld(event.clientX, event.clientY);

      if (drag.kind === "pan") {
        dispatch({
          type: "SET_VIEWPORT",
          viewport: {
            ...drag.viewport,
            x: drag.viewport.x + event.clientX - drag.startX,
            y: drag.viewport.y + event.clientY - drag.startY
          }
        });
        return;
      }
      if (drag.kind === "erase") {
        eraseAt(point);
        return;
      }
      if (drag.kind === "draw") {
        const next = {
          ...drag.element,
          points: [...drag.element.points, [point.x, point.y, event.pressure || 0.5]]
        };
        drag.element = next;
        setPreview(next);
        return;
      }
      if (drag.kind === "shape") {
        const next = {
          ...drag.element,
          width: point.x - drag.start.x,
          height: point.y - drag.start.y
        };
        drag.element = next;
        setPreview(next);
        return;
      }
      if (drag.kind === "move") {
        const next = moveElements(
          drag.startElements,
          drag.selectedIds,
          point.x - drag.start.x,
          point.y - drag.start.y
        );
        dispatch({
          type: "SET_BOARD",
          updater: (b) => updateActivePageElements(b, next, b.hasUserContent)
        });
        // Broadcast live position to collaborators at ~30fps.
        const now = Date.now();
        if (now - (drag.lastMoveBroadcast || 0) > 33) {
          drag.lastMoveBroadcast = now;
          wsRef.current.sendMessage({
            type: "move",
            pageId: activePageIdRef.current,
            elements: next,
            sender: userNameRef.current
          });
        }
        return;
      }
      if (drag.kind === "marquee") {
        const nextBox = {
          x: drag.start.x,
          y: drag.start.y,
          width: point.x - drag.start.x,
          height: point.y - drag.start.y
        };
        setSelectionBox(nextBox);
        const boxIds = getElementsInBox(elementsRef.current, nextBox);
        dispatch({
          type: "SET_SELECTED_IDS",
          ids: drag.additive ? [...new Set([...drag.startSelectedIds, ...boxIds])] : boxIds
        });
      }
    },
    [eraseAt, screenToWorld]
  );

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag?.kind === "draw" && drag.element.points.length > 1) {
      setPreview(null);
      addElementToBoard(drag.element);
    }
    if (drag?.kind === "shape") {
      setPreview(null);
      if (Math.abs(drag.element.width) > 4 || Math.abs(drag.element.height) > 4) {
        addElementToBoard(drag.element);
      }
    }
    if (drag?.kind === "move") {
      // Push the PRE-move state onto undo.
      setUndoStack((stack) => [...stack.slice(-29), drag.startElements]);
      setRedoStack([]);
      // Broadcast the final element positions and persist via REST.
      // We DON'T call commitElements() here because it would push a second
      // undo entry (the post-move state). Instead broadcast + save manually.
      const finalElements = elementsRef.current;
      wsRef.current?.sendMessage?.({
        type: "elements",
        pageId: activePageIdRef.current,
        elements: finalElements,
        sender: userNameRef.current
      });
      const bid = boardIdRef.current;
      const pid = activePageIdRef.current;
      if (bid && pid) {
        savePageElements(bid, pid, finalElements).catch(() => {});
      }
    }
    if (drag?.kind === "marquee") {
      setSelectionBox(null);
    }
  }, [addElementToBoard]);

  const handleWheel = useCallback((event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    dispatch({
      type: "SET_VIEWPORT",
      viewport: {
        ...viewportRef.current,
        zoom: Math.min(2.5, Math.max(0.35, viewportRef.current.zoom * factor))
      }
    });
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const previous = stack[stack.length - 1];
      setRedoStack((redo) => [elementsRef.current, ...redo.slice(0, 29)]);
      dispatch({
        type: "SET_BOARD",
        updater: (b) => updateActivePageElements(b, previous, b.hasUserContent)
      });
      dispatch({ type: "SET_SELECTED_IDS", ids: [] });
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack;
      const next = stack[0];
      setUndoStack((undoItems) => [...undoItems.slice(-29), elementsRef.current]);
      dispatch({
        type: "SET_BOARD",
        updater: (b) => updateActivePageElements(b, next, b.hasUserContent)
      });
      dispatch({ type: "SET_SELECTED_IDS", ids: [] });
      return stack.slice(1);
    });
  }, []);

  const clearBoard = useCallback(() => {
    if (!elementsRef.current.length) return;
    if (!window.confirm("Clear this page?")) return;
    pushUndo(elementsRef.current);
    dispatch({
      type: "SET_BOARD",
      updater: (b) => updateActivePageElements(b, [], b.hasUserContent)
    });
    dispatch({ type: "SET_SELECTED_IDS", ids: [] });
    ws.sendMessage({
      type: "clear",
      pageId: activePageIdRef.current,
      elements: [],
      sender: userNameRef.current
    });
  }, [pushUndo, ws]);

  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.length) return;
    const current = elementsRef.current;
    const next = deleteElements(current, ids);
    pushUndo(current);
    dispatch({
      type: "SET_BOARD",
      updater: (b) => updateActivePageElements(b, next, b.hasUserContent)
    });
    dispatch({ type: "SET_SELECTED_IDS", ids: [] });
    ws.sendMessage({
      type: "delete",
      pageId: activePageIdRef.current,
      elementIds: ids,
      elements: next,
      sender: userNameRef.current
    });
  }, [pushUndo, ws]);

  const duplicateSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.length) return;
    const result = duplicateElements(elementsRef.current, ids);
    commitElements(result.elements);
    dispatch({ type: "SET_SELECTED_IDS", ids: result.copiedIds });
  }, [commitElements]);

  const updateSelectedColor = useCallback(
    (nextColor) => {
      if (!selectedIdsRef.current.length) return;
      commitElements(updateElementsStroke(elementsRef.current, selectedIdsRef.current, nextColor));
    },
    [commitElements]
  );

  const updateSelectedFill = useCallback(
    (nextFill) => {
      if (!selectedIdsRef.current.length) {
        dispatch({ type: "SET_FILL_COLOR", fillColor: nextFill });
        return;
      }
      commitElements(updateElementsFill(elementsRef.current, selectedIdsRef.current, nextFill));
    },
    [commitElements]
  );

  const editSelectedText = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length !== 1) return;
    const target = elementsRef.current.find((el) => el.id === ids[0]);
    if (!target || !["text", "sticky"].includes(target.type)) return;
    const text = window.prompt("Edit text", target.text);
    if (!text) return;
    const next = elementsRef.current.map((el) => (el.id === target.id ? { ...el, text } : el));
    commitElements(next);
  }, [commitElements]);

  const addPage = useCallback(async () => {
    const name = String((state.board?.pages?.length || 0) + 1);
    const localPage = { id: createId("page"), name, elements: [] };

    if (!state.board?.boardId) {
      dispatch({
        type: "ADD_PAGE",
        board: { ...state.board, activePageId: localPage.id, pages: [...state.board.pages, localPage] }
      });
      setUndoStack([]);
      setRedoStack([]);
      dispatch({ type: "SET_SELECTED_IDS", ids: [] });
      onToast?.("Added local page");
      return;
    }
    try {
      const remoteBoard = await boardApi.addPage(name);
      dispatch({
        type: "ADD_PAGE",
        board: {
          ...mergeRemoteBoardMetadata(state.board, remoteBoard)
        }
      });
      const newPage =
        remoteBoard.pages?.find((p) => p.name === name) || remoteBoard.pages?.at(-1);
      if (newPage) {
        dispatch({ type: "SET_ACTIVE_PAGE", pageId: newPage.pageId || newPage.id });
      }
    } catch {
      dispatch({
        type: "ADD_PAGE",
        board: { ...state.board, activePageId: localPage.id, pages: [...state.board.pages, localPage] }
      });
      onToast?.("Backend unavailable, added local page");
    }
    setUndoStack([]);
    setRedoStack([]);
    dispatch({ type: "SET_SELECTED_IDS", ids: [] });
  }, [state.board, boardApi, onToast]);

  const setActivePage = useCallback((pageId) => {
    dispatch({ type: "SET_ACTIVE_PAGE", pageId });
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const exportBoard = useCallback(() => {
    exportBoardPng(elementsRef.current, state.board?.title || "whiteboard");
    onToast?.("Board exported as PNG");
  }, [state.board?.title, onToast]);

  const sendChat = useCallback(
    (text) => {
      if (!canChat(state.board?.room)) {
        onToast?.("Join a room before chatting");
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;
      dispatch({
        type: "ADD_CHAT_MESSAGE",
        message: {
          id: createId("chat"),
          author: state.board?.room?.userName || "You",
          text: trimmed,
          time: "now"
        }
      });
      ws.sendMessage({ type: "chat", author: state.board?.room?.userName || "Partner", text: trimmed });
      setChatText("");
    },
    [state.board, ws, onToast]
  );

  const handleJoinRoom = useCallback(() => {
    dispatch({ type: "JOIN_ROOM", board: joinRoom(state.board, state.roomForm) });
    onToast?.("Joined room");
  }, [state.board, state.roomForm, onToast]);

  const handleLeaveRoom = useCallback(() => {
    dispatch({ type: "LEAVE_ROOM", board: leaveRoom(state.board) });
    setChatText("");
  }, [state.board]);

  const saveTitle = useCallback(() => {
    if (!state.board?.boardId) {
      onToast?.("Create or load a board first");
      return;
    }
    boardApi.saveTitle();
  }, [state.board?.boardId, boardApi, onToast]);

  const updateTitle = useCallback((title) => {
    dispatch({ type: "SET_BOARD", updater: (b) => ({ ...b, title }) });
  }, []);

  const setTool = useCallback((tool) => dispatch({ type: "SET_TOOL", tool }), []);
  const setColor = useCallback((color) => dispatch({ type: "SET_COLOR", color }), []);
  const setFillColor = useCallback((fillColor) => dispatch({ type: "SET_FILL_COLOR", fillColor }), []);
  const setBrushSize = useCallback((brushSize) => dispatch({ type: "SET_BRUSH_SIZE", brushSize }), []);
  const setRoomForm = useCallback(
    (patch) => dispatch({ type: "SET_ROOM_FORM", patch }),
    []
  );
  const setViewport = useCallback(
    (vp) => dispatch({ type: "SET_VIEWPORT", viewport: vp }),
    []
  );
  const zoomBy = useCallback((delta) => {
    dispatch({
      type: "SET_VIEWPORT",
      viewport: {
        ...viewportRef.current,
        zoom: Math.min(2.5, Math.max(0.35, viewportRef.current.zoom + delta))
      }
    });
  }, []);
  const resetViewport = useCallback(
    () => dispatch({ type: "SET_VIEWPORT", viewport: { x: 60, y: 72, zoom: 1 } }),
    []
  );

  // Sync the loaded board into the controller when a board is opened
  // by URL navigation. NOTE: boardApi is excluded from deps intentionally;
  // it is recreated on every render and including it causes an infinite loop.
  // The ref-based loadBoard always calls the latest version.
  const loadBoardRef = useRef(null);
  loadBoardRef.current = boardApi.loadBoard;
  useEffect(() => {
    if (!boardId || !enabled) return;
    if (state.board?.boardId === boardId) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadBoardRef.current(boardId);
        if (cancelled) return;
        dispatch({ type: "MERGE_REMOTE_BOARD", board: remote });
      } catch {
        if (!cancelled) onToast?.("Could not load board from URL");
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, enabled, state.board?.boardId]);

  // --- Memoized derived state -------------------------------------------
  const selectedElements = useMemo(
    () => elements.filter((el) => state.selectedIds.includes(el.id)),
    [elements, state.selectedIds]
  );
  const primarySelection = selectedElements[0];
  const activePage = useMemo(() => getActivePage(state.board), [state.board]);

  return {
    state,
    dispatch,
    elements,
    selectedElements,
    primarySelection,
    activePage,
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
    actions: {
      addElementToBoard,
      addPage,
      addStickyAt,
      addTextAt,
      clearBoard,
      commitElements,
      deleteSelected,
      duplicateSelected,
      editSelectedText,
      eraseAt,
      exportBoard,
      handleJoinRoom,
      handleLeaveRoom,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleWheel,
      redo,
      resetViewport,
      saveTitle,
      sendChat,
      setActivePage,
      setBrushSize,
      setChatText,
      setColor,
      setFillColor,
      setRoomForm,
      setTool,
      setViewport,
      undo,
      updateSelectedColor,
      updateSelectedFill,
      updateTitle,
      zoomBy
    }
  };
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  BookOpen,
  Code,
  Copy,
  Edit2,
  Eye,
  Grid,
  Home,
  Info,
  Layers,
  List,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageSquare,
  Mic,
  MoreVertical,
  Palette,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Scroll,
  Search,
  Send,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  UserRoundPlus,
  Users,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { COLORS, FILL_COLORS, TOOLS } from "./constants/whiteboard.js";
import { useBoardApi, useBoardsList } from "./hooks/useBoardApi.js";
import { useBoardWebSocket } from "./hooks/useBoardWebSocket.js";
import { usePersistentBoard } from "./hooks/usePersistentBoard.js";
import { getApiBaseUrl } from "./services/boardApi.js";
import { renderElement, renderSelectionBox } from "./utils/canvasRenderer.js";
import {
  addChatMessage,
  addUserElement,
  canChat,
  createId,
  createShapeElement,
  deleteElements,
  duplicateElements,
  getActivePage,
  getElementBounds,
  getElementsInBox,
  isFillableElement,
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
} from "./utils/whiteboard.js";
import "./App.css";

const CARD_ICONS = [BookOpen, Palette, Sparkles, Code, Scroll, Shapes, Layers];
const CARD_BG_COLORS = ["#5b4970", "#335359", "#5c4a36", "#394b66", "#4d3d52", "#335645"];

function getCardIcon(index) {
  return CARD_ICONS[index % CARD_ICONS.length];
}

function getCardBgColor(index) {
  return CARD_BG_COLORS[index % CARD_BG_COLORS.length];
}

function formatDate(isoString) {
  if (!isoString) return "Recently";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "Recently";
  }
}

export default function App() {
  const canvasRef = useRef(null);
  const boardWrapRef = useRef(null);
  const dragRef = useRef(null);
  const [board, setBoard, savedAt] = usePersistentBoard();
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#111111");
  const [fillColor, setFillColor] = useState("transparent");
  const [brushSize, setBrushSize] = useState(5);
  const [selectedIds, setSelectedIds] = useState([]);
  const [preview, setPreview] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [viewport, setViewport] = useState({ x: 60, y: 72, zoom: 1 });
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [chatText, setChatText] = useState("");
  const [roomForm, setRoomForm] = useState({ roomName: board.room.name, userName: board.room.userName });
  const [createTitle, setCreateTitle] = useState(board.title || "Unnamed Board");
  const [, setLoadBoardId] = useState(board.boardId || "");
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [isCallOpen, setIsCallOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // Dashboard state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("recent");
  const [viewMode, setViewMode] = useState("grid");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinBoardIdInput, setJoinBoardIdInput] = useState("");
  const [joinUserNameInput, setJoinUserNameInput] = useState(board.room.userName || "Guest");
  const [isJoiningBoard, setIsJoiningBoard] = useState(false);
  const [activeMenuBoardId, setActiveMenuBoardId] = useState(null);
  const [renameBoardData, setRenameBoardData] = useState(null);
  const [renameTitleInput, setRenameTitleInput] = useState("");

  const handleWsMessage = useCallback((msg) => {
    if (!msg) return;
    if (msg.type === "chat" && msg.text && msg.author) {
      setBoard((current) => ({
        ...current,
        chat: [
          ...current.chat,
          { id: createId("chat"), author: msg.author, text: msg.text, time: "now" }
        ]
      }));
    } else if (["elements", "draw", "move", "delete", "clear"].includes(msg.type) && Array.isArray(msg.elements)) {
      setBoard((current) => updateActivePageElements(current, msg.elements, current.hasUserContent));
    }
  }, [setBoard]);

  const ws = useBoardWebSocket({
    boardId: board.boardId,
    enabled: isBoardOpen && Boolean(board.boardId),
    onMessage: handleWsMessage
  });

  const boardApi = useBoardApi({ board, enabled: isBoardOpen, setBoard, setToast });
  const { data: boardsData, isLoading: isLoadingBoards, refetch: refetchBoards } = useBoardsList({ enabled: !isBoardOpen });
  const allBoards = useMemo(() => boardsData?.boards || [], [boardsData?.boards]);

  const filteredBoards = useMemo(() => {
    let list = [...allBoards];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((b) => (b.title || "").toLowerCase().includes(q) || (b.boardId || "").toLowerCase().includes(q));
    }
    if (sortOption === "name") {
      list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else if (sortOption === "oldest") {
      list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else {
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    return list;
  }, [allBoards, searchQuery, sortOption]);

  const activePage = useMemo(() => getActivePage(board), [board]);
  const elements = useMemo(() => activePage?.elements || [], [activePage]);
  const selectedElements = elements.filter((element) => selectedIds.includes(element.id));
  const primarySelection = selectedElements[0];
  const activeTool = useMemo(() => TOOLS.find((item) => item.id === tool), [tool]);

  const commitElements = useCallback(
    (nextElements, { markUserContent = true } = {}) => {
      setUndoStack((stack) => [...stack.slice(-29), elements]);
      setRedoStack([]);
      setBoard((current) => updateActivePageElements(current, nextElements, markUserContent ? true : current.hasUserContent));
      ws.sendMessage({ type: "elements", elements: nextElements, sender: board.room.userName });
    },
    [elements, setBoard, ws, board.room.userName]
  );

  const addElementToBoard = useCallback(
    (element) => {
      setUndoStack((stack) => [...stack.slice(-29), elements]);
      setRedoStack([]);
      setBoard((current) => {
        const nextBoard = addUserElement(current, element);
        const nextElements = getActivePage(nextBoard)?.elements || [];
        ws.sendMessage({ type: "elements", elements: nextElements, sender: current.room.userName });
        return nextBoard;
      });
      setSelectedIds([element.id]);
    },
    [elements, setBoard, ws]
  );

  const screenToWorld = useCallback(
    (clientX, clientY) => {
      const rect = canvasRef.current.getBoundingClientRect();
      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom
      };
    },
    [viewport]
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = boardWrapRef.current;
    if (!canvas || !wrap) return;

    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);
    elements.forEach((element) => renderElement(ctx, element, selectedIds.includes(element.id)));
    if (preview) renderElement(ctx, preview, false);
    if (selectionBox) renderSelectionBox(ctx, selectionBox);
    ctx.restore();
  }, [elements, preview, selectedIds, selectionBox, viewport]);

  useEffect(() => {
    redraw();
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);


  const updateTitle = (title) => {
    setBoard((current) => ({ ...current, title }));
  };

  const handleOpenExistingBoard = async (boardId, title) => {
    setLoadBoardId(boardId);
    try {
      await boardApi.loadBoard(boardId);
      setIsBoardOpen(true);
      setToast(`Opened: ${title || "Board"}`);
    } catch {
      setToast("Could not load board");
    }
  };

  const handleModalCreateSubmit = async (event) => {
    event.preventDefault();
    const title = createTitle.trim() || "Untitled board";
    try {
      const remoteBoard = await boardApi.createNewBoard(title);
      setLoadBoardId(remoteBoard.boardId || "");
      setIsCreateModalOpen(false);
      setIsBoardOpen(true);
      setToast("Board created!");
    } catch {
      setToast("Could not create board");
    }
  };

  const handleJoinBoardSubmit = async (event) => {
    event.preventDefault();
    const rawId = joinBoardIdInput.trim();
    if (!rawId) {
      setToast("Please enter a valid Board ID");
      return;
    }
    let targetBoardId = rawId;
    const uuidMatch = rawId.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    if (uuidMatch) {
      targetBoardId = uuidMatch[0];
    }

    setIsJoiningBoard(true);
    try {
      const remoteBoard = await boardApi.loadBoard(targetBoardId);
      const userName = joinUserNameInput.trim() || "Partner";
      setBoard((current) => ({
        ...joinRoom(current, { roomName: remoteBoard.title || "Collaborative Board", userName }),
        boardId: remoteBoard.boardId,
        title: remoteBoard.title || current.title
      }));
      setLoadBoardId(remoteBoard.boardId);
      setIsJoinModalOpen(false);
      setIsBoardOpen(true);
      setToast(`Joined board as ${userName}!`);
    } catch {
      setToast("Could not find board with that ID");
    } finally {
      setIsJoiningBoard(false);
    }
  };

  const handleStartRename = (b) => {
    setActiveMenuBoardId(null);
    setRenameBoardData(b);
    setRenameTitleInput(b.title || "");
  };

  const handleRenameSubmit = async (event) => {
    event.preventDefault();
    if (!renameBoardData) return;
    const newTitle = renameTitleInput.trim() || "Untitled board";
    try {
      await boardApi.renameBoardTitle(renameBoardData.boardId, newTitle);
      setRenameBoardData(null);
      setToast("Board renamed!");
    } catch {
      setToast("Could not rename board");
    }
  };

  const handleDeleteBoard = async (b) => {
    setActiveMenuBoardId(null);
    if (window.confirm(`Are you sure you want to delete "${b.title || "Untitled board"}"?`)) {
      try {
        await boardApi.deleteBoard(b.boardId);
      } catch {
        setToast("Could not delete board");
      }
    }
  };

  const saveTitleToBackend = async () => {
    boardApi.saveTitle();
  };

  const addTextAt = (point) => {
    const text = window.prompt("Text", "Add your idea");
    if (!text) return;
    addElementToBoard({
      id: createId("text"),
      type: "text",
      x: point.x,
      y: point.y,
      text,
      color,
      size: Math.max(16, brushSize + 13),
      width: 260
    });
  };

  const addStickyAt = (point) => {
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
      fill: fillColor === "transparent" ? "#fef3c7" : fillColor,
      textColor: "#111111"
    });
  };

  const eraseAt = (point) => {
    const next = elements.filter((element) => !isPointInElement(point, element));
    if (next.length !== elements.length) {
      commitElements(next);
      setSelectedIds([]);
    }
  };

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = screenToWorld(event.clientX, event.clientY);

    if (tool === "pan" || event.button === 1 || event.altKey) {
      dragRef.current = { kind: "pan", startX: event.clientX, startY: event.clientY, viewport };
      return;
    }

    if (tool === "text") {
      addTextAt(point);
      return;
    }

    if (tool === "sticky") {
      addStickyAt(point);
      return;
    }

    if (tool === "eraser") {
      eraseAt(point);
      dragRef.current = { kind: "erase" };
      return;
    }

    if (tool === "select") {
      const hitId = pickTopElementId(elements, point);
      if (hitId) {
        const nextSelectedIds = event.shiftKey
          ? toggleSelection(selectedIds, hitId)
          : selectedIds.includes(hitId)
            ? selectedIds
            : [hitId];
        setSelectedIds(nextSelectedIds);
        dragRef.current = {
          kind: "move",
          selectedIds: nextSelectedIds,
          start: point,
          startElements: elements
        };
      } else {
        const baseSelectedIds = event.shiftKey ? selectedIds : [];
        setSelectedIds(baseSelectedIds);
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
        color,
        size: brushSize
      };
      setPreview(element);
      dragRef.current = { kind: "draw", element };
      return;
    }

    if (["line", "arrow", "rect", "ellipse"].includes(tool)) {
      const element = createShapeElement({ tool, point, color, fill: fillColor, brushSize });
      setPreview(element);
      dragRef.current = { kind: "shape", element, start: point };
    }
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = screenToWorld(event.clientX, event.clientY);

    if (drag.kind === "pan") {
      setViewport({
        ...drag.viewport,
        x: drag.viewport.x + event.clientX - drag.startX,
        y: drag.viewport.y + event.clientY - drag.startY
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
      const next = moveElements(drag.startElements, drag.selectedIds, point.x - drag.start.x, point.y - drag.start.y);
      setBoard((current) => updateActivePageElements(current, next, current.hasUserContent));
      return;
    }

    if (drag.kind === "marquee") {
      const nextBox = { x: drag.start.x, y: drag.start.y, width: point.x - drag.start.x, height: point.y - drag.start.y };
      setSelectionBox(nextBox);
      const boxIds = getElementsInBox(elements, nextBox);
      setSelectedIds(drag.additive ? [...new Set([...drag.startSelectedIds, ...boxIds])] : boxIds);
    }
  };

  const handlePointerUp = () => {
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
      setUndoStack((stack) => [...stack.slice(-29), drag.startElements]);
      setRedoStack([]);
    }

    if (drag?.kind === "marquee") {
      setSelectionBox(null);
    }
  };

  const handleWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    setViewport((current) => ({ ...current, zoom: Math.min(2.5, Math.max(0.35, current.zoom * factor)) }));
  };

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const previous = stack[stack.length - 1];
      setRedoStack((redo) => [elements, ...redo.slice(0, 29)]);
      setBoard((current) => updateActivePageElements(current, previous, current.hasUserContent));
      setSelectedIds([]);
      return stack.slice(0, -1);
    });
  }, [elements, setBoard]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack;
      const next = stack[0];
      setUndoStack((undoItems) => [...undoItems.slice(-29), elements]);
      setBoard((current) => updateActivePageElements(current, next, current.hasUserContent));
      setSelectedIds([]);
      return stack.slice(1);
    });
  }, [elements, setBoard]);

  const clearBoard = () => {
    if (elements.length && window.confirm("Clear this page?")) {
      commitElements([]);
      setSelectedIds([]);
    }
  };

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    commitElements(deleteElements(elements, selectedIds));
    setSelectedIds([]);
  }, [commitElements, elements, selectedIds]);

  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    const result = duplicateElements(elements, selectedIds);
    commitElements(result.elements);
    setSelectedIds(result.copiedIds);
  };

  const updateSelectedColor = (nextColor) => {
    if (!selectedIds.length) return;
    commitElements(updateElementsStroke(elements, selectedIds, nextColor));
  };

  const updateSelectedFill = (nextFill) => {
    if (!selectedIds.length) {
      setFillColor(nextFill);
      return;
    }
    commitElements(updateElementsFill(elements, selectedIds, nextFill));
  };

  const editSelectedText = () => {
    if (selectedElements.length !== 1 || !["text", "sticky"].includes(primarySelection.type)) return;
    const text = window.prompt("Edit text", primarySelection.text);
    if (!text) return;
    commitElements(elements.map((element) => (element.id === primarySelection.id ? { ...element, text } : element)));
  };

  const addPage = async () => {
    const name = String(board.pages.length + 1);
    const localPage = { id: createId("page"), name, elements: [] };

    if (!board.boardId) {
      setBoard((current) => ({
        ...current,
        activePageId: localPage.id,
        pages: [...current.pages, localPage]
      }));
      setToast("Added local page");
      return;
    }

    try {
      const remoteBoard = await boardApi.addPage(name);
      setBoard((current) => {
        const merged = mergeRemoteBoardMetadata(current, remoteBoard);
        const newPage = merged.pages.find((page) => page.name === name) || merged.pages.at(-1);
        return {
          ...merged,
          activePageId: newPage?.id || merged.activePageId
        };
      });
    } catch {
      setBoard((current) => ({
        ...current,
        activePageId: localPage.id,
        pages: [...current.pages, localPage]
      }));
      setToast("Backend unavailable, added local page");
    }

    setUndoStack([]);
    setRedoStack([]);
    setSelectedIds([]);
  };

  const exportBoard = () => {
    const canvas = document.createElement("canvas");
    const bounds = elements.reduce(
      (acc, element) => {
        const box = getElementBounds(element);
        return {
          minX: Math.min(acc.minX, box.x),
          minY: Math.min(acc.minY, box.y),
          maxX: Math.max(acc.maxX, box.x + box.width),
          maxY: Math.max(acc.maxY, box.y + box.height)
        };
      },
      { minX: 0, minY: 0, maxX: 1000, maxY: 700 }
    );
    const padding = 80;
    canvas.width = Math.max(900, bounds.maxX - bounds.minX + padding * 2);
    canvas.height = Math.max(620, bounds.maxY - bounds.minY + padding * 2);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(padding - bounds.minX, padding - bounds.minY);
    elements.forEach((element) => renderElement(ctx, element));
    ctx.restore();
    const link = document.createElement("a");
    link.download = `${board.title || "whiteboard"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setToast("Board exported as PNG");
  };

  const invite = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(board.room.name)}`;
    await navigator.clipboard?.writeText(url);
    setToast("Invite link copied");
  };

  const handleJoinRoom = (event) => {
    event.preventDefault();
    setBoard((current) => joinRoom(current, roomForm));
    setToast("Joined room");
  };

  const handleLeaveRoom = () => {
    setBoard((current) => leaveRoom(current));
    setChatText("");
    setToast("Left room");
  };

  const sendChat = (event) => {
    event.preventDefault();
    if (!canChat(board.room)) {
      setToast("Join a room before chatting");
      return;
    }
    const text = chatText.trim();
    if (!text) return;
    setBoard((current) => addChatMessage(current, text));
    ws.sendMessage({ type: "chat", author: board.room.userName || "Partner", text });
    setChatText("");
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      }
      if (event.key === "+") setViewport((current) => ({ ...current, zoom: Math.min(2.5, current.zoom + 0.1) }));
      if (event.key === "-") setViewport((current) => ({ ...current, zoom: Math.max(0.35, current.zoom - 0.1) }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, redo, undo]);

  useEffect(() => {
    if (!toast) return undefined;
    const handle = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(handle);
  }, [toast]);

  if (!isBoardOpen) {
    return (
      <div className="notebook-shell">
        <header className="notebook-header">
          <div className="notebook-brand">
            <div className="notebook-logo">
              <span>Aw</span>
            </div>
            <span className="notebook-brand-title">Realtime Whiteboard</span>
          </div>

          <div className="notebook-search-wrap">
            <Search size={17} className="notebook-search-icon" />
            <input
              type="text"
              className="notebook-search-input"
              placeholder="Search boards by title or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" className="notebook-search-clear" onClick={() => setSearchQuery("")}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="notebook-header-controls">
            <div className="view-mode-toggle">
              <button
                type="button"
                className={`view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                <Grid size={17} />
              </button>
              <button
                type="button"
                className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <List size={17} />
              </button>
            </div>

            <div className="sort-select-wrap">
              <select
                className="notebook-sort-select"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
              >
                <option value="recent">Most recent</option>
                <option value="oldest">Oldest</option>
                <option value="name">Title (A-Z)</option>
              </select>
            </div>

            <button
              type="button"
              className="notebook-secondary-btn"
              onClick={() => {
                setJoinBoardIdInput("");
                setIsJoinModalOpen(true);
              }}
              style={{ marginRight: "10px" }}
            >
              <UserRoundPlus size={18} />
              <span>Join with ID</span>
            </button>

            <button
              type="button"
              className="notebook-primary-btn"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus size={18} />
              <span>Create new</span>
            </button>
          </div>
        </header>

        <main className="notebook-content">
          <div className="notebook-section-head">
            <h2>My boards ({filteredBoards.length})</h2>
            <div className="section-head-actions">
              <button
                type="button"
                className="notebook-icon-btn"
                onClick={() => refetchBoards()}
                title="Refresh list"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          <div className={`notebook-cards-container ${viewMode === "list" ? "is-list" : ""}`}>
            {/* CARD 1: CREATE NEW BOARD */}
            <div
              className="notebook-card create-new-card"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <div className="create-icon-badge">
                <Plus size={32} />
              </div>
              <span className="create-card-text">Create new board</span>
            </div>

            {/* CARD 2: JOIN BOARD AS PARTNER */}
            <div
              className="notebook-card join-board-card"
              onClick={() => {
                setJoinBoardIdInput("");
                setIsJoinModalOpen(true);
              }}
            >
              <div className="join-icon-badge">
                <UserRoundPlus size={32} />
              </div>
              <span className="create-card-text">Join Board as Partner</span>
              <span className="join-card-sub">Collaborate using Board ID</span>
            </div>

            {/* EXISTING BOARDS CARDS */}
            {isLoadingBoards ? (
              <div className="notebook-state-msg">Loading boards from database...</div>
            ) : filteredBoards.length === 0 ? (
              searchQuery ? (
                <div className="notebook-state-msg">No boards found matching &quot;{searchQuery}&quot;</div>
              ) : null
            ) : (
              filteredBoards.map((b, idx) => {
                const IconComp = getCardIcon(idx);
                const isMenuOpen = activeMenuBoardId === b.boardId;
                const pageCount = (b.pages && b.pages.length) || 1;

                return (
                  <div
                    key={b.boardId}
                    className="notebook-card board-item-card"
                    onClick={() => handleOpenExistingBoard(b.boardId, b.title)}
                  >
                    <div className="card-header-row">
                      <div className="card-avatar" style={{ backgroundColor: getCardBgColor(idx) }}>
                        <IconComp size={22} color="#ffffff" />
                      </div>

                      <div className="card-menu-container" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={`card-menu-trigger ${isMenuOpen ? "active" : ""}`}
                          onClick={() => setActiveMenuBoardId(isMenuOpen ? null : b.boardId)}
                          aria-label="Board options"
                        >
                          <MoreVertical size={18} />
                        </button>

                        {isMenuOpen && (
                          <div className="card-dropdown">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuBoardId(null);
                                handleOpenExistingBoard(b.boardId, b.title);
                              }}
                            >
                              <Play size={14} />
                              <span>Open board</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuBoardId(null);
                                setJoinBoardIdInput(b.boardId);
                                setIsJoinModalOpen(true);
                              }}
                            >
                              <Users size={14} />
                              <span>Join as Partner</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartRename(b)}
                            >
                              <Edit2 size={14} />
                              <span>Rename board</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuBoardId(null);
                                navigator.clipboard?.writeText(b.boardId);
                                setToast("Board ID copied to clipboard!");
                              }}
                            >
                              <Copy size={14} />
                              <span>Copy ID</span>
                            </button>
                            <button
                              type="button"
                              className="delete-item"
                              onClick={() => handleDeleteBoard(b)}
                            >
                              <Trash2 size={14} color="#ef4444" />
                              <span style={{ color: "#ef4444" }}>Delete board</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="card-info">
                      <h3 className="card-board-title">{b.title || "Untitled board"}</h3>
                      <div className="card-board-meta">
                        <span>{formatDate(b.createdAt)}</span>
                        <span className="meta-sep">•</span>
                        <span>{pageCount} {pageCount === 1 ? "page" : "pages"}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>

        {/* MODAL FOR CREATING NEW BOARD */}
        {isCreateModalOpen && (
          <div className="notebook-modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
            <div className="notebook-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="notebook-modal-head">
                <h3>Create new board</h3>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleModalCreateSubmit}>
                <div className="notebook-modal-body">
                  <label htmlFor="modal-board-title">Board Title</label>
                  <input
                    id="modal-board-title"
                    type="text"
                    autoFocus
                    placeholder="Enter board title (e.g. System Design, Whiteboard notes...)"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                  />
                </div>
                <div className="notebook-modal-foot">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setIsCreateModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-submit"
                    disabled={boardApi.isCreatingBoard}
                  >
                    {boardApi.isCreatingBoard ? "Creating..." : "Create and Open"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL FOR JOINING EXISTING BOARD */}
        {isJoinModalOpen && (
          <div className="notebook-modal-overlay" onClick={() => setIsJoinModalOpen(false)}>
            <div className="notebook-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="notebook-modal-head">
                <h3>Join Board as Partner</h3>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setIsJoinModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleJoinBoardSubmit}>
                <div className="notebook-modal-body">
                  <label htmlFor="modal-join-id">Board ID or Share Link</label>
                  <input
                    id="modal-join-id"
                    type="text"
                    autoFocus
                    placeholder="Paste Board ID (e.g. 550e8400-e29b-41d4-a716-446655440000)..."
                    value={joinBoardIdInput}
                    onChange={(e) => setJoinBoardIdInput(e.target.value)}
                  />
                  <label htmlFor="modal-join-username" style={{ marginTop: "14px" }}>Your Name (Partner)</label>
                  <input
                    id="modal-join-username"
                    type="text"
                    placeholder="Enter your name..."
                    value={joinUserNameInput}
                    onChange={(e) => setJoinUserNameInput(e.target.value)}
                  />
                </div>
                <div className="notebook-modal-foot">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setIsJoinModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-submit"
                    disabled={isJoiningBoard}
                  >
                    {isJoiningBoard ? "Joining..." : "Join & Work Together"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL FOR RENAMING EXISTING BOARD */}
        {renameBoardData && (
          <div className="notebook-modal-overlay" onClick={() => setRenameBoardData(null)}>
            <div className="notebook-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="notebook-modal-head">
                <h3>Rename board</h3>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setRenameBoardData(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleRenameSubmit}>
                <div className="notebook-modal-body">
                  <label htmlFor="modal-rename-title">New Board Title</label>
                  <input
                    id="modal-rename-title"
                    type="text"
                    autoFocus
                    placeholder="Enter new board title..."
                    value={renameTitleInput}
                    onChange={(e) => setRenameTitleInput(e.target.value)}
                  />
                </div>
                <div className="notebook-modal-foot">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setRenameBoardData(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-submit"
                    disabled={boardApi.isRenamingBoard}
                  >
                    {boardApi.isRenamingBoard ? "Saving..." : "Save Title"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {toast && (
          <div className="toast">
            <Save size={16} />
            <span>{toast}</span>
            <button type="button" onClick={() => setToast("")} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Realtime whiteboard logo">
          <span>Aw</span>
        </div>
        <div className="board-title-card">
          <input
            value={board.title}
            onChange={(event) => updateTitle(event.target.value)}
            onBlur={saveTitleToBackend}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Board title"
          />
          <span>Last saved: {savedAt}</span>
        </div>
        <div className={`api-pill ${boardApi.status}`} title={boardApi.error || getApiBaseUrl()}>
          {boardApi.status === "offline" ? "API offline" : boardApi.status === "saving" ? "Saving API" : "API connected"}
        </div>
        <button className="icon-command" type="button" onClick={undo} aria-label="Undo" title="Undo" disabled={!undoStack.length}>
          <Undo2 size={18} />
        </button>
        <button className="icon-command" type="button" onClick={redo} aria-label="Redo" title="Redo" disabled={!redoStack.length}>
          <Redo2 size={18} />
        </button>
        <button className="command" type="button" onClick={exportBoard}>
          <ArrowDownToLine size={18} />
          <span>Export board</span>
        </button>
        <button className="command invite" type="button" onClick={invite}>
          <UserRoundPlus size={18} />
          <span>Invite</span>
        </button>
        <div className="topbar-spacer" />
        <button className="icon-command" type="button" aria-label="Home" title="Home" onClick={() => setIsBoardOpen(false)}>
          <Home size={18} />
        </button>
        <button className="command muted" type="button">
          <Info size={18} />
          <span>Learn more</span>
        </button>
        <div className="profile-pill">
          <span className="avatar">{(board.room.userName || "C").slice(0, 1).toUpperCase()}</span>
          <span>{board.room.userName || "Guest"}</span>
        </div>
      </header>

      <aside className="toolbar" aria-label="Whiteboard tools">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tool === id ? "active" : ""}
            type="button"
            onClick={() => setTool(id)}
            title={label}
            aria-label={label}
          >
            <Icon size={20} />
          </button>
        ))}
        <span className="toolbar-separator" />
        <button type="button" onClick={clearBoard} title="Clear page" aria-label="Clear page">
          <Trash2 size={20} />
        </button>
      </aside>

      <main className="board-stage">
        <div className={`canvas-wrap ${tool === "pan" ? "is-panning" : ""}`} ref={boardWrapRef} onWheel={handleWheel}>
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            aria-label="Collaborative whiteboard canvas"
          />
          <div className={`connection-chip ${ws.isConnected ? "connected" : "connecting"}`}>
            <LoaderCircle size={15} className={ws.isConnected ? "pulse-icon" : "spin-icon"} />
            <span>
              {ws.isConnected
                ? `Live Sync: ${board.title || "Connected"}`
                : ws.status === "connecting"
                  ? "Connecting WebSocket..."
                  : "Offline Board"}
            </span>
          </div>
        </div>
      </main>

      <aside className="zoom-rail" aria-label="View controls">
        <button type="button" onClick={() => setIsRightPanelOpen((value) => !value)} title="Toggle panel" aria-label="Toggle panel">
          <Eye size={19} />
        </button>
        <button type="button" onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(2.5, current.zoom + 0.1) }))} title="Zoom in" aria-label="Zoom in">
          <ZoomIn size={19} />
        </button>
        <span>{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.35, current.zoom - 0.1) }))} title="Zoom out" aria-label="Zoom out">
          <ZoomOut size={19} />
        </button>
        <button type="button" onClick={() => setViewport({ x: 60, y: 72, zoom: 1 })} title="Reset view" aria-label="Reset view">
          <Shapes size={19} />
        </button>
      </aside>

      {selectedElements.length > 0 && (
        <div className="floating-panel">
          <span className="selection-count">{selectedElements.length}</span>
          <input className="color-input" type="color" value={primarySelection?.color || color} onChange={(event) => updateSelectedColor(event.target.value)} aria-label="Selected stroke color" />
          <button type="button" onClick={editSelectedText} disabled={selectedElements.length !== 1 || !["text", "sticky"].includes(primarySelection?.type)} title="Edit text" aria-label="Edit text">
            <Type size={18} />
          </button>
          <button type="button" onClick={duplicateSelected} title="Duplicate" aria-label="Duplicate">
            <Copy size={18} />
          </button>
          <button type="button" onClick={deleteSelected} title="Delete" aria-label="Delete">
            <Trash2 size={18} />
          </button>
        </div>
      )}

      <section className="style-panel" aria-label="Drawing style">
        <div className="style-title">
          <Palette size={17} />
          <span>{activeTool?.label}</span>
        </div>
        <div className="swatches">
          {COLORS.map((item) => (
            <button
              key={item}
              type="button"
              className={color === item ? "selected" : ""}
              style={{ background: item }}
              onClick={() => setColor(item)}
              aria-label={`Use color ${item}`}
            />
          ))}
        </div>
        <div className="fill-row">
          <span>Fill</span>
          <div className="fill-swatches">
            {FILL_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                className={fillColor === item || selectedElements.some((element) => element.fill === item) ? "selected" : ""}
                style={{ background: item === "transparent" ? "linear-gradient(135deg, #fff 45%, #ef4444 46%, #ef4444 54%, #fff 55%)" : item }}
                onClick={() => updateSelectedFill(item)}
                disabled={selectedElements.length > 0 && !selectedElements.some(isFillableElement)}
                aria-label={`Use fill ${item}`}
              />
            ))}
          </div>
        </div>
        <label className="brush-control">
          <span>{brushSize}px</span>
          <input min="2" max="24" type="range" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
        </label>
      </section>

      <nav className="page-strip" aria-label="Pages">
        {board.pages.map((page, index) => (
          <button
            key={page.id}
            type="button"
            className={page.id === board.activePageId ? "active" : ""}
            onClick={() => {
              setBoard((current) => ({ ...current, activePageId: page.id }));
              setUndoStack([]);
              setRedoStack([]);
              setSelectedIds([]);
            }}
          >
            {index + 1}
          </button>
        ))}
        <button type="button" onClick={addPage} title="Add page" aria-label="Add page">
          <Plus size={19} />
        </button>
      </nav>

      {isRightPanelOpen && (
        <aside className="collab-panel">
          {!board.room.isJoined ? (
            <form className="room-card" onSubmit={handleJoinRoom}>
              <div className="room-heading">
                <LogIn size={18} />
                <strong>Join room</strong>
              </div>
              <input
                value={roomForm.roomName}
                onChange={(event) => setRoomForm((current) => ({ ...current, roomName: event.target.value }))}
                placeholder="Room name"
                aria-label="Room name"
              />
              <input
                value={roomForm.userName}
                onChange={(event) => setRoomForm((current) => ({ ...current, userName: event.target.value }))}
                placeholder="Your name"
                aria-label="Your name"
              />
              <button type="submit">Join collaborative room</button>
            </form>
          ) : (
            <>
              {isCallOpen && (
                <div className="call-card">
                  <div>
                    <strong>{board.room.name}</strong>
                    <small>Connected as {board.room.userName}</small>
                  </div>
                  <Mic size={18} />
                  <button type="button" onClick={() => setIsCallOpen(false)}>Hang up</button>
                </div>
              )}
              <div className="participants-card">
                <div>
                  <Users size={18} />
                  <strong>{board.room.participants.length} editors</strong>
                </div>
                <button className="leave-room" type="button" onClick={handleLeaveRoom}>
                  <LogOut size={16} />
                  <span>Leave</span>
                </button>
              </div>
              <div className="chat-log">
                {board.chat.length === 0 ? (
                  <div className="empty-chat">No messages yet.</div>
                ) : (
                  board.chat.slice(-8).map((message) => (
                    <div key={message.id} className={message.author === board.room.userName ? "chat-bubble mine" : "chat-bubble"}>
                      <strong>{message.author}</strong>
                      <span>{message.text}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
          <form className="chat-input" onSubmit={sendChat}>
            <MessageSquare size={18} />
            <input
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              placeholder={board.room.isJoined ? "Type here" : "Join room to chat"}
              aria-label="Chat message"
              disabled={!board.room.isJoined}
            />
            <button type="submit" aria-label="Send chat" disabled={!board.room.isJoined}>
              <Send size={17} />
            </button>
          </form>
        </aside>
      )}

      {toast && (
        <div className="toast">
          <Save size={16} />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

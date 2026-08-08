import { DEFAULT_ROOM } from "../constants/whiteboard.js";
import { initialBoard } from "../data/initialBoard.js";

export function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function sanitizeBoard(board) {
  const safeBoard = board && Array.isArray(board.pages) ? board : initialBoard;
  return {
    ...initialBoard,
    ...safeBoard,
    room: {
      ...DEFAULT_ROOM,
      ...(safeBoard.room || {}),
      participants: Array.isArray(safeBoard.room?.participants) ? safeBoard.room.participants : []
    },
    chat: Array.isArray(safeBoard.chat)
      ? safeBoard.chat.filter((message) => message.author !== "Board" && message.kind !== "activity")
      : []
  };
}

export function mergeRemoteBoardMetadata(currentBoard, remoteBoard) {
  if (!remoteBoard?.boardId) return currentBoard;

  const existingById = new Map(currentBoard.pages.map((page) => [page.id, page]));
  const existingByName = new Map(currentBoard.pages.map((page) => [page.name, page]));
  const firstExistingPage = currentBoard.pages[0];

  const pages = (remoteBoard.pages || []).map((remotePage, index) => {
    const id = remotePage.pageId || remotePage.id;
    const name = remotePage.name || String(index + 1);
    const existing = existingById.get(id) || existingByName.get(name) || (index === 0 ? firstExistingPage : null);

    return {
      id,
      name,
      elements: existing?.elements || []
    };
  });

  const nextPages = pages.length ? pages : currentBoard.pages;
  const activePageStillExists = nextPages.some((page) => page.id === currentBoard.activePageId);

  return {
    ...currentBoard,
    boardId: remoteBoard.boardId,
    title: remoteBoard.title || currentBoard.title,
    pages: nextPages,
    activePageId: activePageStillExists ? currentBoard.activePageId : nextPages[0]?.id || currentBoard.activePageId,
    room: {
      ...currentBoard.room,
      name: remoteBoard.title || currentBoard.room.name || "Whiteboard Room",
      isJoined: true
    }
  };
}

export function getActivePage(board) {
  return board.pages.find((page) => page.id === board.activePageId) || board.pages[0];
}

export function updateActivePageElements(board, elements, hasUserContent = board.hasUserContent) {
  return {
    ...board,
    hasUserContent,
    pages: board.pages.map((page) => (page.id === board.activePageId ? { ...page, elements } : page))
  };
}

export function shouldClearStarterElements(board, elements) {
  return !board.hasUserContent && elements.length > 0 && elements.every((element) => element.isTemplate);
}

export function addUserElement(board, element) {
  const page = getActivePage(board);
  const base = shouldClearStarterElements(board, page.elements) ? [] : page.elements;
  return updateActivePageElements(board, [...base, { ...element, isTemplate: false }], true);
}

export function addUserElements(board, newElements) {
  const page = getActivePage(board);
  const base = shouldClearStarterElements(board, page.elements) ? [] : page.elements;
  return updateActivePageElements(
    board,
    [...base, ...newElements.map((element) => ({ ...element, isTemplate: false }))],
    true
  );
}

export function getElementBounds(element) {
  if (element.type === "stroke") {
    const xs = element.points.map(([x]) => x);
    const ys = element.points.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX,
      y: minY,
      width: Math.max(1, Math.max(...xs) - minX),
      height: Math.max(1, Math.max(...ys) - minY)
    };
  }

  if (["line", "arrow"].includes(element.type)) {
    const x = Math.min(element.x, element.x + element.width);
    const y = Math.min(element.y, element.y + element.height);
    return { x, y, width: Math.max(1, Math.abs(element.width)), height: Math.max(1, Math.abs(element.height)) };
  }

  if (element.type === "text") {
    const lines = Math.max(1, Math.ceil((element.text || "").length / 28));
    return { x: element.x, y: element.y, width: element.width || 220, height: lines * (element.size || 18) * 1.25 };
  }

  return { x: element.x, y: element.y, width: element.width || 1, height: element.height || 1 };
}

export function isPointInElement(point, element) {
  const box = getElementBounds(element);
  return point.x >= box.x - 10 && point.x <= box.x + box.width + 10 && point.y >= box.y - 10 && point.y <= box.y + box.height + 10;
}

export function getElementsInBox(elements, box) {
  const normalized = normalizeBox(box);
  return elements
    .filter((element) => {
      const bounds = getElementBounds(element);
      return (
        bounds.x >= normalized.x &&
        bounds.y >= normalized.y &&
        bounds.x + bounds.width <= normalized.x + normalized.width &&
        bounds.y + bounds.height <= normalized.y + normalized.height
      );
    })
    .map((element) => element.id);
}

export function normalizeBox(box) {
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height)
  };
}

export function pickTopElementId(elements, point) {
  return [...elements].reverse().find((element) => isPointInElement(point, element))?.id || null;
}

export function toggleSelection(selectedIds, elementId) {
  if (!elementId) return selectedIds;
  return selectedIds.includes(elementId) ? selectedIds.filter((id) => id !== elementId) : [...selectedIds, elementId];
}

export function moveElements(elements, selectedIds, deltaX, deltaY) {
  return elements.map((element) => {
    if (!selectedIds.includes(element.id)) return element;
    if (element.type === "stroke") {
      return {
        ...element,
        points: element.points.map(([x, y, pressure = 0.5]) => [x + deltaX, y + deltaY, pressure])
      };
    }
    return { ...element, x: element.x + deltaX, y: element.y + deltaY };
  });
}

export function deleteElements(elements, selectedIds) {
  return elements.filter((element) => !selectedIds.includes(element.id));
}

export function duplicateElements(elements, selectedIds) {
  const copies = elements
    .filter((element) => selectedIds.includes(element.id))
    .map((element) => ({
      ...element,
      id: createId(element.type),
      x: typeof element.x === "number" ? element.x + 24 : undefined,
      y: typeof element.y === "number" ? element.y + 24 : undefined,
      points: element.points?.map(([x, y, pressure = 0.5]) => [x + 24, y + 24, pressure]),
      isTemplate: false
    }));
  return { elements: [...elements, ...copies], copiedIds: copies.map((element) => element.id) };
}

export function updateElementsStroke(elements, selectedIds, color) {
  return elements.map((element) => (selectedIds.includes(element.id) ? { ...element, color } : element));
}

export function updateElementsFill(elements, selectedIds, fill) {
  return elements.map((element) => (selectedIds.includes(element.id) && isFillableElement(element) ? { ...element, fill } : element));
}

export function isFillableElement(element) {
  return ["rect", "ellipse", "sticky"].includes(element.type);
}

export function createShapeElement({ tool, point, color, fill, brushSize }) {
  return {
    id: createId(tool),
    type: tool,
    x: point.x,
    y: point.y,
    width: 1,
    height: 1,
    color,
    fill: isFillableElement({ type: tool }) ? fill : "transparent",
    size: brushSize,
    isTemplate: false
  };
}

export function joinRoom(board, { roomName, userName }) {
  const cleanUserName = userName?.trim() || "Guest";
  const cleanRoomName = roomName?.trim() || board.room.name || "Whiteboard Room";
  return {
    ...board,
    room: {
      ...board.room,
      name: cleanRoomName,
      userName: cleanUserName,
      isJoined: true,
      participants: [
        { id: "local-user", name: cleanUserName, color: "#64be75" }
      ]
    }
  };
}

export function leaveRoom(board) {
  return {
    ...board,
    room: {
      ...board.room,
      isJoined: false,
      participants: []
    },
    chat: []
  };
}

export function canChat(room) {
  return Boolean(room?.isJoined);
}

export function addChatMessage(board, text) {
  if (!canChat(board.room) || !text.trim()) return board;
  return {
    ...board,
    chat: [
      ...board.chat,
      {
        id: createId("chat"),
        author: board.room.userName || "You",
        text: text.trim(),
        time: "now"
      }
    ]
  };
}

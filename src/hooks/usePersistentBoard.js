import { useState } from "react";
import { initialBoard } from "../data/initialBoard.js";
import { sanitizeBoard } from "../utils/whiteboard.js";

// Must match the key written by useWhiteboardController's localStorage effect.
export const getBoardStorageKey = (boardId) =>
  boardId ? `whiteboard_board_${boardId}` : "whiteboard_board_default";

/**
 * Reads the initial board from localStorage keyed by boardId.
 * Does NOT write back — the controller's useEffect handles writing.
 * This avoids any state updates on the persistence path that could
 * cause re-render loops.
 */
export function usePersistentBoard(boardId) {
  const [board] = useState(() => {
    try {
      const key = getBoardStorageKey(boardId);
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Validate that stored data actually belongs to this boardId.
        if (parsed && (!boardId || parsed.boardId === boardId)) {
          return sanitizeBoard(parsed);
        }
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
    return sanitizeBoard(initialBoard);
  });

  // savedAt is a display-only value shown in TopBar.
  const savedAt = "auto-saved";

  return [board, null, savedAt];
}

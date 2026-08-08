import { useState } from "react";
import { BOARD_STORAGE_KEY } from "../constants/whiteboard.js";
import { initialBoard } from "../data/initialBoard.js";
import { sanitizeBoard } from "../utils/whiteboard.js";

export function usePersistentBoard() {
  const [board, setBoard] = useState(() => {
    try {
      localStorage.removeItem(BOARD_STORAGE_KEY);
    } catch {
      // Ignore storage errors in restricted contexts
    }
    return sanitizeBoard(initialBoard);
  });

  return [board, setBoard, "live"];
}

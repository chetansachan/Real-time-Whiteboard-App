import { useEffect, useState } from "react";
import { BOARD_STORAGE_KEY } from "../constants/whiteboard.js";
import { initialBoard } from "../data/initialBoard.js";
import { sanitizeBoard } from "../utils/whiteboard.js";

export function usePersistentBoard() {
  const [board, setBoard] = useState(() => {
    try {
      const saved = localStorage.getItem(BOARD_STORAGE_KEY);
      return saved ? sanitizeBoard(JSON.parse(saved)) : initialBoard;
    } catch {
      return initialBoard;
    }
  });
  const [savedAt, setSavedAt] = useState("just now");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(board));
      setSavedAt("just now");
    }, 350);
    return () => window.clearTimeout(handle);
  }, [board]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSavedAt((current) => (current === "just now" ? "seconds ago" : current));
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  return [board, setBoard, savedAt];
}

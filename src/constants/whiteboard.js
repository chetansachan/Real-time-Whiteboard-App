import {
  ArrowDownToLine,
  Circle,
  Eraser,
  Hand,
  Minus,
  MousePointer2,
  PenLine,
  Square,
  StickyNote,
  Type
} from "lucide-react";

export const BOARD_STORAGE_KEY = "realtime-whiteboard-state-v2";

export const COLORS = [
  "#111111",
  "#57534e",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6"
];

export const FILL_COLORS = ["transparent", "#fef3c7", "#dcfce7", "#dbeafe", "#fee2e2", "#ede9fe", "#fce7f3"];

export const TOOLS = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "pen", label: "Pen", icon: PenLine },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: ArrowDownToLine },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "text", label: "Text", icon: Type },
  { id: "sticky", label: "Sticky note", icon: StickyNote },
  { id: "pan", label: "Pan", icon: Hand }
];

export const DEFAULT_ROOM = {
  id: "demo-room",
  name: "Story Room",
  isJoined: false,
  userName: "Chetan",
  participants: []
};

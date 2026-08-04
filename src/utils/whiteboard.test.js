import { describe, expect, it } from "vitest";
import { initialBoard } from "../data/initialBoard.js";
import {
  addChatMessage,
  addUserElement,
  createShapeElement,
  deleteElements,
  duplicateElements,
  getElementsInBox,
  joinRoom,
  leaveRoom,
  moveElements,
  sanitizeBoard,
  toggleSelection,
  updateElementsFill
} from "./whiteboard.js";

function boardCopy() {
  return structuredClone(initialBoard);
}

describe("starter template behavior", () => {
  it("removes default template drawings when the first user stroke is added", () => {
    const board = boardCopy();
    const next = addUserElement(board, {
      id: "stroke-real",
      type: "stroke",
      points: [
        [10, 10, 0.5],
        [20, 20, 0.5]
      ],
      color: "#111111",
      size: 5
    });

    expect(next.hasUserContent).toBe(true);
    expect(next.pages[0].elements).toHaveLength(1);
    expect(next.pages[0].elements[0].id).toBe("stroke-real");
    expect(next.pages[0].elements[0].isTemplate).toBe(false);
  });

  it("keeps existing user work when another element is added", () => {
    const board = addUserElement(boardCopy(), {
      id: "rect-real",
      type: "rect",
      x: 0,
      y: 0,
      width: 40,
      height: 30,
      color: "#111111",
      fill: "transparent",
      size: 4
    });

    const next = addUserElement(board, {
      id: "ellipse-real",
      type: "ellipse",
      x: 50,
      y: 50,
      width: 20,
      height: 20,
      color: "#111111",
      fill: "#dbeafe",
      size: 4
    });

    expect(next.pages[0].elements.map((element) => element.id)).toEqual(["rect-real", "ellipse-real"]);
  });
});

describe("room and chat behavior", () => {
  it("blocks chat messages until the user joins a room", () => {
    const board = boardCopy();
    const next = addChatMessage(board, "hello");

    expect(next.chat).toHaveLength(0);
  });

  it("allows chat only for joined users and does not mix drawing events into chat", () => {
    const joined = joinRoom(boardCopy(), { roomName: "Design", userName: "Chetan" });
    const withChat = addChatMessage(joined, "hello room");

    expect(withChat.chat).toHaveLength(1);
    expect(withChat.chat[0]).toMatchObject({ author: "Chetan", text: "hello room" });
  });

  it("leaving a room disables chat and clears room-only chat messages", () => {
    const joined = joinRoom(boardCopy(), { roomName: "Design", userName: "Chetan" });
    const withChat = addChatMessage(joined, "hello room");
    const left = leaveRoom(withChat);

    expect(left.room.isJoined).toBe(false);
    expect(left.room.participants).toHaveLength(0);
    expect(left.chat).toHaveLength(0);
  });

  it("sanitizes old persisted board activity messages out of chat", () => {
    const oldBoard = {
      ...boardCopy(),
      chat: [
        { id: "activity", author: "Board", text: "Stroke broadcast locally" },
        { id: "message", author: "Chetan", text: "Real message" }
      ]
    };

    expect(sanitizeBoard(oldBoard).chat).toEqual([{ id: "message", author: "Chetan", text: "Real message" }]);
  });
});

describe("multi-select behavior", () => {
  const elements = [
    { id: "a", type: "rect", x: 10, y: 10, width: 20, height: 20, color: "#111111", fill: "transparent", size: 4 },
    { id: "b", type: "ellipse", x: 50, y: 50, width: 20, height: 20, color: "#111111", fill: "transparent", size: 4 },
    { id: "c", type: "text", x: 120, y: 120, width: 100, text: "outside", color: "#111111", size: 18 }
  ];

  it("selects multiple elements inside a marquee box", () => {
    expect(getElementsInBox(elements, { x: 0, y: 0, width: 90, height: 90 })).toEqual(["a", "b"]);
  });

  it("toggles selected IDs for shift-click style selection", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("moves every selected element together", () => {
    const moved = moveElements(elements, ["a", "b"], 5, 7);

    expect(moved.find((element) => element.id === "a")).toMatchObject({ x: 15, y: 17 });
    expect(moved.find((element) => element.id === "b")).toMatchObject({ x: 55, y: 57 });
    expect(moved.find((element) => element.id === "c")).toMatchObject({ x: 120, y: 120 });
  });

  it("deletes and duplicates all selected elements", () => {
    expect(deleteElements(elements, ["a", "b"]).map((element) => element.id)).toEqual(["c"]);

    const duplicated = duplicateElements(elements, ["a", "b"]);
    expect(duplicated.elements).toHaveLength(5);
    expect(duplicated.copiedIds).toHaveLength(2);
  });
});

describe("shape fill behavior", () => {
  it("creates fillable shapes with the selected fill color", () => {
    const shape = createShapeElement({
      tool: "rect",
      point: { x: 10, y: 10 },
      color: "#111111",
      fill: "#dbeafe",
      brushSize: 5
    });

    expect(shape.fill).toBe("#dbeafe");
  });

  it("updates fill only for fillable selected elements", () => {
    const elements = [
      { id: "rect", type: "rect", x: 0, y: 0, width: 20, height: 20, fill: "transparent" },
      { id: "line", type: "line", x: 0, y: 0, width: 20, height: 20, fill: "transparent" }
    ];

    const next = updateElementsFill(elements, ["rect", "line"], "#dcfce7");

    expect(next.find((element) => element.id === "rect").fill).toBe("#dcfce7");
    expect(next.find((element) => element.id === "line").fill).toBe("transparent");
  });
});

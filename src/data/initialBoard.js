import { DEFAULT_ROOM } from "../constants/whiteboard.js";

const template = true;

export const initialBoard = {
  title: "Unnamed Board",
  activePageId: "page-1",
  hasUserContent: false,
  room: DEFAULT_ROOM,
  pages: [
    {
      id: "page-1",
      name: "1",
      elements: [
        {
          id: "sample-1",
          type: "text",
          x: 132,
          y: 132,
          text: "Main Character",
          color: "#111111",
          size: 18,
          width: 180,
          isTemplate: template
        },
        {
          id: "sample-2",
          type: "text",
          x: 382,
          y: 144,
          text: "Make them relatable",
          color: "#111111",
          size: 18,
          width: 220,
          isTemplate: template
        },
        {
          id: "sample-3",
          type: "text",
          x: 646,
          y: 144,
          text: "Call to Action ... where are they being summoned?",
          color: "#111111",
          size: 18,
          width: 300,
          isTemplate: template
        },
        {
          id: "sample-4",
          type: "stroke",
          points: [
            [74, 80, 0.5],
            [94, 74, 0.5],
            [108, 92, 0.5],
            [100, 116, 0.5],
            [82, 124, 0.5],
            [72, 108, 0.5],
            [74, 80, 0.5]
          ],
          color: "#111111",
          size: 4,
          isTemplate: template
        },
        {
          id: "sample-5",
          type: "arrow",
          x: 194,
          y: 114,
          width: 170,
          height: 18,
          color: "#6b7280",
          fill: "transparent",
          size: 4,
          isTemplate: template
        },
        {
          id: "sample-6",
          type: "rect",
          x: 414,
          y: 80,
          width: 54,
          height: 68,
          color: "#111111",
          fill: "transparent",
          size: 4,
          isTemplate: template
        },
        {
          id: "sample-7",
          type: "ellipse",
          x: 612,
          y: 48,
          width: 94,
          height: 92,
          color: "#111111",
          fill: "transparent",
          size: 4,
          isTemplate: template
        },
        {
          id: "sample-8",
          type: "sticky",
          x: 184,
          y: 338,
          text: "This is the main starting point of your story. The reader needs this information to connect with the MC and understand where they are going.",
          color: "#fef3c7",
          textColor: "#111111",
          width: 460,
          height: 108,
          isTemplate: template
        }
      ]
    }
  ],
  chat: []
};

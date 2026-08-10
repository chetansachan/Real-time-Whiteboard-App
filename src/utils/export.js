// Off-screen PNG export for the active page's elements.

import { getElementBounds } from "./whiteboard.js";
import { renderElement } from "./canvasRenderer.js";

/**
 * Render elements to an off-screen canvas, then trigger a download.
 *
 * @param {Array} elements
 * @param {string} title
 */
export function exportBoardPng(elements, title) {
  const bounds = computeBounds(elements);
  const padding = 80;
  const width = Math.max(900, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(620, bounds.maxY - bounds.minY + padding * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(padding - bounds.minX, padding - bounds.minY);
  elements.forEach((element) => renderElement(ctx, element));
  ctx.restore();

  const link = document.createElement("a");
  link.download = `${slugify(title) || "whiteboard"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function computeBounds(elements) {
  return elements.reduce(
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
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

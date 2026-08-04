import getStroke from "perfect-freehand";
import { getElementBounds, isFillableElement, normalizeBox } from "./whiteboard.js";

export function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let offsetY = 0;
  words.forEach((word) => {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + offsetY);
      line = word;
      offsetY += lineHeight;
    } else {
      line = testLine;
    }
  });
  if (line) ctx.fillText(line, x, y + offsetY);
}

function drawArrowHead(ctx, fromX, fromY, toX, toY, color, size) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const length = Math.max(14, size * 4);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - length * Math.cos(angle - Math.PI / 6), toY - length * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - length * Math.cos(angle + Math.PI / 6), toY - length * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

export function renderElement(ctx, element, selected = false) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = element.color || "#111111";
  ctx.fillStyle = element.color || "#111111";
  ctx.lineWidth = element.size || 3;

  if (element.type === "stroke") {
    const stroke = getStroke(element.points, {
      size: element.size || 4,
      thinning: 0.48,
      smoothing: 0.58,
      streamline: 0.5
    });
    const path = new Path2D(getSvgPathFromStroke(stroke));
    ctx.fill(path);
  }

  if (["line", "arrow"].includes(element.type)) {
    ctx.beginPath();
    ctx.moveTo(element.x, element.y);
    ctx.lineTo(element.x + element.width, element.y + element.height);
    ctx.stroke();
    if (element.type === "arrow") {
      drawArrowHead(ctx, element.x, element.y, element.x + element.width, element.y + element.height, element.color, element.size || 3);
    }
  }

  if (element.type === "rect") {
    if (isFillableElement(element) && element.fill && element.fill !== "transparent") {
      ctx.fillStyle = element.fill;
      ctx.fillRect(element.x, element.y, element.width, element.height);
    }
    ctx.strokeRect(element.x, element.y, element.width, element.height);
  }

  if (element.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      element.x + element.width / 2,
      element.y + element.height / 2,
      Math.abs(element.width / 2),
      Math.abs(element.height / 2),
      0,
      0,
      Math.PI * 2
    );
    if (element.fill && element.fill !== "transparent") {
      ctx.fillStyle = element.fill;
      ctx.fill();
    }
    ctx.stroke();
  }

  if (element.type === "text") {
    ctx.fillStyle = element.color || "#111111";
    ctx.font = `${element.size || 18}px Inter, Arial, sans-serif`;
    ctx.textBaseline = "top";
    drawWrappedText(ctx, element.text, element.x, element.y, element.width || 240, (element.size || 18) * 1.25);
  }

  if (element.type === "sticky") {
    ctx.fillStyle = element.fill || element.color || "#fef3c7";
    ctx.strokeStyle = element.color || "#f2d37d";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(element.x, element.y, element.width, element.height, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = element.textColor || "#111111";
    ctx.font = "16px Inter, Arial, sans-serif";
    ctx.textBaseline = "top";
    drawWrappedText(ctx, element.text, element.x + 16, element.y + 16, element.width - 32, 22);
  }

  if (selected) {
    const box = getElementBounds(element);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
  }

  ctx.restore();
}

export function renderSelectionBox(ctx, box) {
  const normalized = normalizeBox(box);
  ctx.save();
  ctx.fillStyle = "rgba(100, 190, 117, 0.1)";
  ctx.strokeStyle = "#64be75";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.fillRect(normalized.x, normalized.y, normalized.width, normalized.height);
  ctx.strokeRect(normalized.x, normalized.y, normalized.width, normalized.height);
  ctx.restore();
}

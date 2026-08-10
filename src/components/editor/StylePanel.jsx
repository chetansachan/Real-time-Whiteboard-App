import { Palette } from "lucide-react";
import { COLORS, FILL_COLORS, TOOLS } from "../../constants/whiteboard.js";
import { isFillableElement } from "../../utils/whiteboard.js";

const FILL_GRADIENT = "linear-gradient(135deg, #fff 45%, #ef4444 46%, #ef4444 54%, #fff 55%)";

export default function StylePanel({
  tool,
  color,
  setColor,
  fillColor,
  setFillColor,
  brushSize,
  setBrushSize,
  selectedElements,
  updateSelectedColor,
  updateSelectedFill
}) {
  const activeTool = TOOLS.find((t) => t.id === tool);
  const hasFillableSelection = selectedElements.length > 0 && selectedElements.some(isFillableElement);

  return (
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
            onClick={() => {
              setColor(item);
              if (selectedElements.length) updateSelectedColor(item);
            }}
            aria-label={`Use color ${item}`}
            aria-pressed={color === item}
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
              className={
                fillColor === item || selectedElements.some((element) => element.fill === item)
                  ? "selected"
                  : ""
              }
              style={{ background: item === "transparent" ? FILL_GRADIENT : item }}
              onClick={() => {
                setFillColor(item);
                updateSelectedFill(item);
              }}
              disabled={selectedElements.length > 0 && !hasFillableSelection}
              aria-label={`Use fill ${item}`}
              aria-pressed={fillColor === item}
            />
          ))}
        </div>
      </div>
      <label className="brush-control">
        <span>{brushSize}px</span>
        <input
          min="2"
          max="24"
          type="range"
          value={brushSize}
          onChange={(event) => setBrushSize(Number(event.target.value))}
          aria-label="Brush size"
        />
      </label>
    </section>
  );
}

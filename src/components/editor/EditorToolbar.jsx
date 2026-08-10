import { Trash2 } from "lucide-react";
import { TOOLS } from "../../constants/whiteboard.js";

export default function EditorToolbar({ tool, setTool, onClearPage }) {
  return (
    <aside className="toolbar" aria-label="Whiteboard tools">
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={tool === id ? "active" : ""}
          type="button"
          onClick={() => setTool(id)}
          title={label}
          aria-label={label}
          aria-pressed={tool === id}
        >
          <Icon size={20} />
        </button>
      ))}
      <span className="toolbar-separator" />
      <button type="button" onClick={onClearPage} title="Clear page" aria-label="Clear page">
        <Trash2 size={20} />
      </button>
    </aside>
  );
}

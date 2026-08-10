import { Plus } from "lucide-react";

export default function PageStrip({ pages, activePageId, onSelect, onAdd }) {
  return (
    <nav className="page-strip" aria-label="Pages">
      {pages.map((page, index) => (
        <button
          key={page.id}
          type="button"
          className={page.id === activePageId ? "active" : ""}
          onClick={() => onSelect(page.id)}
          aria-current={page.id === activePageId ? "page" : undefined}
        >
          {index + 1}
        </button>
      ))}
      <button type="button" onClick={onAdd} title="Add page" aria-label="Add page">
        <Plus size={19} />
      </button>
    </nav>
  );
}

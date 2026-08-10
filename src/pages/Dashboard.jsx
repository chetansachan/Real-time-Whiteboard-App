import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Code, Copy, Edit2, Grid, List, MoreVertical, Palette, Plus, RefreshCw, Scroll, Shapes, Layers, Sparkles, Trash2, UserRoundPlus, X, Search, Play, Users } from "lucide-react";
import { useBoardsList } from "../hooks/useBoardApi.js";
import { useToast } from "../hooks/useToast.js";
import Modal from "../components/Modal.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";

const CARD_ICONS = [BookOpen, Palette, Sparkles, Code, Scroll, Shapes, Layers];
const CARD_BG_COLORS = ["#5b4970", "#335359", "#5c4a36", "#394b66", "#4d3d52", "#335645"];

const formatDate = (isoString) => {
  if (!isoString) return "Recently";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "Recently";
  }
};

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isLoading, refetch } = useBoardsList();
  const allBoards = useMemo(() => data?.boards || [], [data?.boards]);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("recent");
  const [viewMode, setViewMode] = useState("grid");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [activeMenuBoardId, setActiveMenuBoardId] = useState(null);
  const [renameBoardData, setRenameBoardData] = useState(null);
  const [renameTitle, setRenameTitle] = useState("");

  const filteredBoards = useMemo(() => {
    let list = [...allBoards];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (b) => (b.title || "").toLowerCase().includes(q) || (b.boardId || "").toLowerCase().includes(q)
      );
    }
    if (sortOption === "name") {
      list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else if (sortOption === "oldest") {
      list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else {
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    return list;
  }, [allBoards, searchQuery, sortOption]);

  const handleOpenBoard = useCallback(
    async (boardId, title) => {
      try {
        const res = await fetch(`/api/boards/${boardId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        navigate(`/board/${boardId}`);
        toast.show(`Opened: ${title || "Board"}`);
      } catch {
        toast.show("Could not load board");
      }
    },
    [navigate, toast]
  );

  const handleDeleteBoard = useCallback(
    async (b) => {
      setActiveMenuBoardId(null);
      if (!window.confirm(`Are you sure you want to delete "${b.title || "Untitled board"}"?`)) return;
      try {
        await fetch(`/api/boards/${b.boardId}`, { method: "DELETE" });
        refetch();
        toast.show("Board deleted");
      } catch {
        toast.show("Could not delete board");
      }
    },
    [refetch, toast]
  );

  const copyBoardId = useCallback(
    async (boardId) => {
      setActiveMenuBoardId(null);
      try {
        await navigator.clipboard?.writeText(boardId);
        toast.show("Board ID copied to clipboard!");
      } catch {
        toast.show("Could not copy ID");
      }
    },
    [toast]
  );

  return (
    <div className="notebook-shell">
      <header className="notebook-header">
        <div className="notebook-brand" onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
          <div className="notebook-logo">
            <span>Aw</span>
          </div>
          <span className="notebook-brand-title">Realtime Whiteboard</span>
        </div>

        <div className="notebook-search-wrap">
          <Search size={17} className="notebook-search-icon" />
          <input
            type="text"
            className="notebook-search-input"
            placeholder="Search boards by title or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search boards"
          />
          {searchQuery && (
            <button
              type="button"
              className="notebook-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="notebook-header-controls">
          <div className="view-mode-toggle">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid view"
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <Grid size={17} />
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
              title="List view"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List size={17} />
            </button>
          </div>

          <div className="sort-select-wrap">
            <select
              className="notebook-sort-select"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              aria-label="Sort boards"
            >
              <option value="recent">Most recent</option>
              <option value="oldest">Oldest</option>
              <option value="name">Title (A-Z)</option>
            </select>
          </div>

          <button
            type="button"
            className="notebook-secondary-btn"
            onClick={() => setIsJoinOpen(true)}
            style={{ marginRight: "10px" }}
          >
            <UserRoundPlus size={18} />
            <span>Join with ID</span>
          </button>

          <button
            type="button"
            className="notebook-primary-btn"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={18} />
            <span>Create new</span>
          </button>
        </div>
      </header>

      <main className="notebook-content">
        <div className="notebook-section-head">
          <h2>My boards ({filteredBoards.length})</h2>
          <div className="section-head-actions">
            <button
              type="button"
              className="notebook-icon-btn"
              onClick={() => refetch()}
              title="Refresh list"
              aria-label="Refresh boards"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        <div className={`notebook-cards-container ${viewMode === "list" ? "is-list" : ""}`}>
          <div
            className="notebook-card create-new-card"
            onClick={() => setIsCreateOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setIsCreateOpen(true);
            }}
          >
            <div className="create-icon-badge">
              <Plus size={32} />
            </div>
            <span className="create-card-text">Create new board</span>
          </div>

          <div
            className="notebook-card join-board-card"
            onClick={() => setIsJoinOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setIsJoinOpen(true);
            }}
          >
            <div className="join-icon-badge">
              <UserRoundPlus size={32} />
            </div>
            <span className="create-card-text">Join Board as Partner</span>
            <span className="join-card-sub">Collaborate using Board ID</span>
          </div>

          {isLoading ? (
            <div className="notebook-state-msg">
              <LoadingSpinner label="Loading boards" />
            </div>
          ) : filteredBoards.length === 0 && searchQuery ? (
            <div className="notebook-state-msg">No boards found matching &quot;{searchQuery}&quot;</div>
          ) : (
            filteredBoards.map((b, idx) => {
              const IconComp = CARD_ICONS[idx % CARD_ICONS.length];
              const isMenuOpen = activeMenuBoardId === b.boardId;
              const pageCount = (b.pages && b.pages.length) || 1;
              return (
                <div
                  key={b.boardId}
                  className="notebook-card board-item-card"
                  onClick={() => handleOpenBoard(b.boardId, b.title)}
                >
                  <div className="card-header-row">
                    <div className="card-avatar" style={{ backgroundColor: CARD_BG_COLORS[idx % CARD_BG_COLORS.length] }}>
                      <IconComp size={22} color="#ffffff" />
                    </div>

                    <div className="card-menu-container" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`card-menu-trigger ${isMenuOpen ? "active" : ""}`}
                        onClick={() => setActiveMenuBoardId(isMenuOpen ? null : b.boardId)}
                        aria-label="Board options"
                        aria-expanded={isMenuOpen}
                      >
                        <MoreVertical size={18} />
                      </button>

                      {isMenuOpen && (
                        <div className="card-dropdown" role="menu">
                          <button type="button" role="menuitem" onClick={() => handleOpenBoard(b.boardId, b.title)}>
                            <Play size={14} />
                            <span>Open board</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setActiveMenuBoardId(null);
                              // Reuse the join modal with this id prefilled.
                              setIsJoinOpen(true);
                            }}
                          >
                            <Users size={14} />
                            <span>Join as Partner</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setActiveMenuBoardId(null);
                              setRenameBoardData(b);
                              setRenameTitle(b.title || "");
                            }}
                          >
                            <Edit2 size={14} />
                            <span>Rename board</span>
                          </button>
                          <button type="button" role="menuitem" onClick={() => copyBoardId(b.boardId)}>
                            <Copy size={14} />
                            <span>Copy ID</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="delete-item"
                            onClick={() => handleDeleteBoard(b)}
                          >
                            <Trash2 size={14} color="#ef4444" />
                            <span style={{ color: "#ef4444" }}>Delete board</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card-info">
                    <h3 className="card-board-title">{b.title || "Untitled board"}</h3>
                    <div className="card-board-meta">
                      <span>{formatDate(b.createdAt)}</span>
                      <span className="meta-sep">•</span>
                      <span>{pageCount} {pageCount === 1 ? "page" : "pages"}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <CreateBoardModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(boardId) => navigate(`/board/${boardId}`)}
        showToast={toast.show}
      />
      <JoinBoardModal
        open={isJoinOpen}
        onClose={() => setIsJoinOpen(false)}
        onJoined={(boardId) => navigate(`/board/${boardId}`)}
        showToast={toast.show}
      />
      <RenameBoardModal
        board={renameBoardData}
        title={renameTitle}
        setTitle={setRenameTitle}
        onClose={() => {
          setRenameBoardData(null);
          refetch();
        }}
        showToast={toast.show}
      />
    </div>
  );
}

// --- Modals (kept colocated; trivial to extract later) --------------------

function CreateBoardModal({ open, onClose, onCreated, showToast }) {
  const [title, setTitle] = useState("Unnamed Board");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle("Unnamed Board");
    setSubmitting(false);
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || "Untitled board" })
      });
      if (!res.ok) throw new Error("create failed");
      const board = await res.json();
      onClose();
      reset();
      onCreated(board.boardId);
      showToast("Board created!");
    } catch {
      showToast("Could not create board");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Create new board"
      footer={
        <>
          <button
            type="button"
            className="btn-cancel"
            onClick={() => {
              onClose();
              reset();
            }}
          >
            Cancel
          </button>
          <button type="button" className="btn-submit" disabled={submitting} onClick={handleSubmit}>
            {submitting ? "Creating..." : "Create and Open"}
          </button>
        </>
      }
    >
      <form id="create-board-form" onSubmit={handleSubmit} className="notebook-modal-body">
        <label htmlFor="modal-board-title">Board Title</label>
        <input
          id="modal-board-title"
          type="text"
          autoFocus
          placeholder="Enter board title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function JoinBoardModal({ open, onClose, onJoined, showToast }) {
  const [boardId, setBoardId] = useState("");
  const [userName, setUserName] = useState("Partner");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setBoardId("");
    setUserName("Partner");
    setSubmitting(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!boardId.trim()) {
      showToast("Please enter a valid Board ID");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/boards/${encodeURIComponent(boardId.trim())}`);
      if (!res.ok) throw new Error("not found");
      onClose();
      onJoined(boardId.trim());
      showToast(`Joined board as ${userName || "Partner"}!`);
      reset();
    } catch {
      showToast("Could not find board with that ID");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Join Board as Partner"
      footer={
        <>
          <button
            type="button"
            className="btn-cancel"
            onClick={() => {
              onClose();
              reset();
            }}
          >
            Cancel
          </button>
          <button type="submit" form="join-board-form" className="btn-submit" disabled={submitting}>
            {submitting ? "Joining..." : "Join & Work Together"}
          </button>
        </>
      }
    >
      <form id="join-board-form" onSubmit={handleSubmit} className="notebook-modal-body">
        <label htmlFor="modal-join-id">Board ID or Share Link</label>
        <input
          id="modal-join-id"
          type="text"
          autoFocus
          placeholder="Paste Board ID..."
          value={boardId}
          onChange={(e) => setBoardId(e.target.value)}
        />
        <label htmlFor="modal-join-username" style={{ marginTop: "14px" }}>
          Your Name (Partner)
        </label>
        <input
          id="modal-join-username"
          type="text"
          placeholder="Enter your name..."
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function RenameBoardModal({ board, title, setTitle, onClose, showToast }) {
  const [submitting, setSubmitting] = useState(false);

  if (!board) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/boards/${encodeURIComponent(board.boardId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || "Untitled board" })
      });
      if (!res.ok) throw new Error("rename failed");
      onClose();
      showToast("Board renamed!");
    } catch {
      showToast("Could not rename board");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!board}
      onClose={onClose}
      title="Rename board"
      footer={
        <>
          <button type="button" className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-submit" disabled={submitting} onClick={handleSubmit}>
            {submitting ? "Saving..." : "Save Title"}
          </button>
        </>
      }
    >
      <form id="rename-board-form" onSubmit={handleSubmit} className="notebook-modal-body">
        <label htmlFor="modal-rename-title">New Board Title</label>
        <input
          id="modal-rename-title"
          type="text"
          autoFocus
          placeholder="Enter new board title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </form>
    </Modal>
  );
}

import { ArrowDownToLine, Home, Info, Redo2, Undo2, UserRoundPlus } from "lucide-react";
import { getApiBaseUrl } from "../../services/boardApi.js";

export default function TopBar({
  boardTitle,
  savedAt,
  onTitleChange,
  onTitleSave,
  onUndo,
  onRedo,
  onExport,
  onInvite,
  canUndo,
  canRedo,
  apiStatus,
  apiError,
  onHome,
  userName
}) {
  const pillText =
    apiStatus === "offline"
      ? "API offline"
      : apiStatus === "saving"
        ? "Saving API"
        : "API connected";
  return (
    <header className="topbar">
      <div
        className="brand"
        aria-label="Realtime whiteboard logo"
        onClick={onHome}
        style={{ cursor: "pointer" }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onHome?.();
        }}
      >
        <span>Aw</span>
      </div>
      <div className="board-title-card">
        <input
          value={boardTitle}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={onTitleSave}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Board title"
        />
        <span>Last saved: {savedAt}</span>
      </div>
      <div className={`api-pill ${apiStatus}`} title={apiError || getApiBaseUrl()}>
        {pillText}
      </div>
      <button
        className="icon-command"
        type="button"
        onClick={onUndo}
        aria-label="Undo"
        title="Undo"
        disabled={!canUndo}
      >
        <Undo2 size={18} />
      </button>
      <button
        className="icon-command"
        type="button"
        onClick={onRedo}
        aria-label="Redo"
        title="Redo"
        disabled={!canRedo}
      >
        <Redo2 size={18} />
      </button>
      <button className="command" type="button" onClick={onExport}>
        <ArrowDownToLine size={18} />
        <span>Export board</span>
      </button>
      <button className="command invite" type="button" onClick={onInvite}>
        <UserRoundPlus size={18} />
        <span>Invite</span>
      </button>
      <div className="topbar-spacer" />
      <button className="icon-command" type="button" aria-label="Home" title="Home" onClick={onHome}>
        <Home size={18} />
      </button>
      <button className="command muted" type="button" disabled>
        <Info size={18} />
        <span>Learn more</span>
      </button>
      <div className="profile-pill">
        <span className="avatar">{(userName || "C").slice(0, 1).toUpperCase()}</span>
        <span>{userName || "Guest"}</span>
      </div>
    </header>
  );
}

import { LogIn, LogOut, MessageSquare, Send, Users } from "lucide-react";

/**
 * Right-side room + chat panel. The host page owns the actual state
 * (board.chat, board.room, chatText) and hands down handlers.
 */
export default function CollabPanel({
  room,
  chat,
  isOpen,
  roomForm,
  setRoomForm,
  onJoin,
  onLeave,
  chatText,
  setChatText,
  onSendChat
}) {
  if (!isOpen) return null;

  return (
    <aside className="collab-panel">
      {room?.isJoined ? (
        <>
          <div className="participants-card">
            <div>
              <Users size={18} />
              <strong>{room.participants?.length || 0} editors</strong>
            </div>
            <button className="leave-room" type="button" onClick={onLeave}>
              <LogOut size={16} />
              <span>Leave</span>
            </button>
          </div>
          <div className="chat-log" aria-live="polite">
            {chat.length === 0 ? (
              <div className="empty-chat">No messages yet.</div>
            ) : (
              chat.slice(-8).map((message) => (
                <div
                  key={message.id}
                  className={message.author === room.userName ? "chat-bubble mine" : "chat-bubble"}
                >
                  <strong>{message.author}</strong>
                  <span>{message.text}</span>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <form className="room-card" onSubmit={onJoin}>
          <div className="room-heading">
            <LogIn size={18} />
            <strong>Join room</strong>
          </div>
          <input
            value={roomForm.roomName}
            onChange={(e) => setRoomForm({ roomName: e.target.value })}
            placeholder="Room name"
            aria-label="Room name"
          />
          <input
            value={roomForm.userName}
            onChange={(e) => setRoomForm({ userName: e.target.value })}
            placeholder="Your name"
            aria-label="Your name"
          />
          <button type="submit">Join collaborative room</button>
        </form>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          onSendChat(chatText);
        }}
      >
        <MessageSquare size={18} />
        <input
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          placeholder={room?.isJoined ? "Type here" : "Join room to chat"}
          aria-label="Chat message"
          disabled={!room?.isJoined}
        />
        <button type="submit" aria-label="Send chat" disabled={!room?.isJoined}>
          <Send size={17} />
        </button>
      </form>
    </aside>
  );
}

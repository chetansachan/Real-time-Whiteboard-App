// Package websocket hosts the per-board realtime hub. One Hub is created
// per active board; clients connect, fan out messages to everyone else in
// the same hub, and the hub persists persistent events asynchronously.
package websocket

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"realtime-whiteboard/internals/model"
	"realtime-whiteboard/internals/service"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Config tunes a single ServeWS installation. Sensible defaults are
// returned by NewConfig.
type Config struct {
	// ReadLimit caps the size of a single incoming message.
	ReadLimit int64
	// WriteWait is the deadline for any single WriteMessage call.
	WriteWait time.Duration
	// PongWait is how long we wait for a pong before declaring the
	// connection dead.
	PongWait time.Duration
	// PingPeriod is how often we send a ping. Must be < PongWait.
	PingPeriod time.Duration
	// AllowedOrigins is the list of origins allowed by CheckOrigin. Use
	// nil to fall back to same-origin only.
	AllowedOrigins []string
}

// NewConfig returns a Config with conservative defaults.
func NewConfig() Config {
	return Config{
		ReadLimit:  1 << 20, // 1 MiB
		WriteWait:  10 * time.Second,
		PongWait:   60 * time.Second,
		PingPeriod: 30 * time.Second,
	}
}

// Hub keeps track of clients currently subscribed to a single board.
type Hub struct {
	BoardID      uuid.UUID
	clients      map[*Client]struct{}
	register     chan *Client
	unregister   chan *Client
	inbound      chan inboundMessage
	boardService *service.BoardService
	logger       *slog.Logger
	done         chan struct{}
	mu           sync.RWMutex // protects clients
}

type inboundMessage struct {
	sender  *Client
	content []byte
}

// HubManager owns one Hub per active board. Hubs are created on demand
// and torn down once the last client disconnects.
type HubManager struct {
	rooms        map[string]*Hub
	boardService *service.BoardService
	logger       *slog.Logger
	mu           sync.Mutex
}

// NewHubManager returns an empty manager.
func NewHubManager(boardService *service.BoardService, logger *slog.Logger) *HubManager {
	return &HubManager{
		rooms:        make(map[string]*Hub),
		boardService: boardService,
		logger:       logger,
	}
}

// GetOrCreateHub returns the hub for boardID, creating it if needed.
// The hub's Run loop is launched in its own goroutine.
func (hm *HubManager) GetOrCreateHub(boardID uuid.UUID) *Hub {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	key := boardID.String()
	if hub, ok := hm.rooms[key]; ok {
		return hub
	}

	hub := newHub(boardID, hm.boardService, hm.logger)
	hm.rooms[key] = hub
	go hub.run()
	return hub
}

// removeHubIfEmpty deletes the hub entry if no clients are connected.
// Safe to call concurrently with client add/remove.
func (hm *HubManager) removeHubIfEmpty(boardID uuid.UUID) {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	key := boardID.String()
	hub, ok := hm.rooms[key]
	if !ok {
		return
	}
	hub.mu.RLock()
	empty := len(hub.clients) == 0
	hub.mu.RUnlock()
	if empty {
		delete(hm.rooms, key)
		close(hub.done)
	}
}

func newHub(boardID uuid.UUID, svc *service.BoardService, logger *slog.Logger) *Hub {
	return &Hub{
		BoardID:      boardID,
		clients:      make(map[*Client]struct{}),
		register:     make(chan *Client),
		unregister:   make(chan *Client),
		inbound:      make(chan inboundMessage, 64),
		boardService: svc,
		logger:       logger,
		done:         make(chan struct{}),
	}
}

// Client is a single websocket connection.
type Client struct {
	ID      uuid.UUID
	UserID  uuid.UUID
	BoardID uuid.UUID
	Hub     *Hub
	Conn    *websocket.Conn
	Send    chan []byte
}

// upgrader is initialized lazily so callers can pass per-deployment
// origin rules via ServeWS.
func newUpgrader(cfg Config) websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     checkOrigin(cfg.AllowedOrigins),
	}
}

func checkOrigin(allowed []string) func(*http.Request) bool {
	if len(allowed) == 0 {
		return func(r *http.Request) bool { return true }
	}
	allowedSet := make(map[string]struct{}, len(allowed))
	allowAll := false
	for _, o := range allowed {
		if o == "*" {
			allowAll = true
		}
		allowedSet[o] = struct{}{}
	}
	return func(r *http.Request) bool {
		if allowAll {
			return true
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // non-browser clients have no Origin
		}
		_, ok := allowedSet[origin]
		return ok
	}
}

// run is the hub's main loop. It serialises client add/remove and the
// processing of inbound messages so we never need a lock around the
// hub-wide state. A blocking DB call in the message handler will stall
// delivery, so the DB writes are dispatched to short-lived goroutines.
func (h *Hub) run() {
	for {
		select {
		case <-h.done:
			return
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = struct{}{}
			h.mu.Unlock()
			h.logger.Info("ws_client_connected",
				slog.String("board_id", h.BoardID.String()),
				slog.String("client_id", c.ID.String()),
			)
		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.Send)
			}
			h.mu.Unlock()
			h.logger.Info("ws_client_disconnected",
				slog.String("board_id", h.BoardID.String()),
				slog.String("client_id", c.ID.String()),
			)
		case msg := <-h.inbound:
			h.handleInbound(msg)
		}
	}
}

// handleInbound persists what needs persisting and fans the message out
// to every other client. The hub.mu RLock is held only across the
// fan-out, never across DB calls.
func (h *Hub) handleInbound(msg inboundMessage) {
	var payload struct {
		ID      string          `json:"id,omitempty"`
		Type    string          `json:"type"`
		Sender  string          `json:"sender,omitempty"`
		PageID  string          `json:"pageId,omitempty"`
		Payload json.RawMessage `json:"payload,omitempty"`
	}
	if err := json.Unmarshal(msg.content, &payload); err != nil {
		h.logger.Warn("ws_bad_message", slog.String("error", err.Error()))
		return
	}

	// Persist element updates to the snapshot store (best-effort).
	if h.boardService != nil && isElementEvent(payload.Type) {
		var elementsMsg model.Elements
		if err := json.Unmarshal(msg.content, &elementsMsg); err == nil {
			go h.persistElements(payload.PageID, elementsMsg.Elements)
		} else {
			h.logger.Warn("ws_save_elements_unmarshal_failed", slog.String("error", err.Error()))
		}
	}

	// Persist a durable event log entry (skip ephemeral types).
	broadcast := msg.content
	if h.boardService != nil && !isEphemeral(payload.Type) {
		env := model.EventEnvelope{
			ID:        payload.ID,
			Type:      payload.Type,
			BoardID:   h.BoardID.String(),
			PageID:    payload.PageID,
			UserID:    msg.sender.UserID.String(),
			CreatedAt: time.Now().UTC(),
			Payload:   msg.content,
		}
		if cursor, err := h.boardService.SaveEventService(context.Background(), &env); err == nil {
			env.Cursor = cursor
			if b, err := json.Marshal(env); err == nil {
				broadcast = b
			}
		} else {
			h.logger.Warn("ws_event_save_failed", slog.String("error", err.Error()))
		}
	}

	h.fanOut(msg.sender, broadcast)
}

func (h *Hub) persistElements(pageID string, elements []model.Element) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.boardService.SavePageElementsService(ctx, h.BoardID, pageID, elements); err != nil {
		h.logger.Warn("ws_save_elements_failed", slog.String("error", err.Error()))
	}
}

func (h *Hub) fanOut(sender *Client, payload []byte) {
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		if c == sender {
			continue
		}
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.Send <- payload:
		default:
			// Slow consumer: drop them so we don't block the hub.
			h.logger.Warn("ws_slow_consumer_dropped",
				slog.String("client_id", c.ID.String()),
			)
			h.unregister <- c
		}
	}
}

func isElementEvent(t string) bool {
	switch t {
	case "elements", "draw", "move", "delete", "clear":
		return true
	}
	return false
}

func isEphemeral(t string) bool {
	switch t {
	case "presence.cursor", "cursor", "presence.join", "presence.leave":
		return true
	}
	return false
}

// readPump reads messages from the websocket connection and feeds them to
// the hub. It also enforces the pong deadline.
func (c *Client) readPump(cfg Config) {
	defer func() {
		c.Hub.unregister <- c
		_ = c.Conn.Close()
	}()
	c.Conn.SetReadLimit(cfg.ReadLimit)
	_ = c.Conn.SetReadDeadline(time.Now().Add(cfg.PongWait))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(cfg.PongWait))
		return nil
	})
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure,
				websocket.CloseNormalClosure) {
				c.Hub.logger.Warn("ws_read_error",
					slog.String("error", err.Error()),
				)
			}
			return
		}
		select {
		case c.Hub.inbound <- inboundMessage{sender: c, content: message}:
		case <-c.Hub.done:
			return
		}
	}
}

// writePump ships messages from the hub to the websocket and sends
// periodic pings to keep the connection alive.
func (c *Client) writePump(cfg Config) {
	ticker := time.NewTicker(cfg.PingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.Conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(cfg.WriteWait))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(cfg.WriteWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.Hub.done:
			return
		}
	}
}

// ServeWS is the HTTP handler invoked by the router. It upgrades the
// connection, replays any missed events, and starts the read/write pumps.
func ServeWS(hm *HubManager, cfg Config, logger *slog.Logger, w http.ResponseWriter, r *http.Request) {
	boardID, err := uuid.Parse(r.PathValue("boardId"))
	if err != nil {
		http.Error(w, "invalid board id", http.StatusBadRequest)
		return
	}

	var lastSeenCursor int64
	if v := r.URL.Query().Get("cursor"); v != "" {
		if parsed, perr := strconv.ParseInt(v, 10, 64); perr == nil {
			lastSeenCursor = parsed
		}
	}

	upgrader := newUpgrader(cfg)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Warn("ws_upgrade_failed", slog.String("error", err.Error()))
		return
	}

	hub := hm.GetOrCreateHub(boardID)
	client := &Client{
		ID:      uuid.New(),
		UserID:  uuid.New(),
		BoardID: boardID,
		Hub:     hub,
		Conn:    conn,
		Send:    make(chan []byte, 256),
	}

	syncClientWithSnapshot(hub, client)
	syncClientWithMissedEvents(hub, client, lastSeenCursor, logger)

	hub.register <- client

	go client.writePump(cfg)
	go client.readPump(cfg)

	// When the read pump exits the client is already unregistering; we
	// wait for the last client to leave before tearing the hub down.
	go func() {
		// Poll briefly so we don't block the read pump on the hub mu.
		for {
			hub.mu.RLock()
			empty := len(hub.clients) == 0
			hub.mu.RUnlock()
			if empty {
				hm.removeHubIfEmpty(boardID)
				return
			}
			time.Sleep(5 * time.Second)
		}
	}()
}

func syncClientWithSnapshot(hub *Hub, client *Client) {
	if hub.boardService == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	boardData, err := hub.boardService.GetBoardByIDService(ctx, hub.BoardID.String())
	if err != nil {
		return
	}
	for _, page := range boardData.Pages {
		if len(page.Elements) == 0 {
			continue
		}
		syncMsg := model.Elements{
			Type:     "elements",
			PageID:   page.PageID.String(),
			Elements: page.Elements,
		}
		if msgBytes, err := json.Marshal(syncMsg); err == nil {
			select {
			case client.Send <- msgBytes:
			default:
			}
		}
	}
}

func syncClientWithMissedEvents(hub *Hub, client *Client, lastSeenCursor int64, logger *slog.Logger) {
	if hub.boardService == nil || lastSeenCursor <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	res, err := hub.boardService.GetEventsAfterService(ctx, hub.BoardID.String(), lastSeenCursor)
	if err != nil {
		logger.Warn("ws_event_replay_failed", slog.String("error", err.Error()))
		return
	}
	for _, evt := range res.Events {
		if evtBytes, err := json.Marshal(evt); err == nil {
			select {
			case client.Send <- evtBytes:
			default:
			}
		}
	}
}

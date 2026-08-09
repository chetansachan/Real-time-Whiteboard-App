package websocket

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"realtime-whiteboard/internals/model"
	"realtime-whiteboard/internals/service"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Hub struct {
	BoardID      uuid.UUID
	Clients      map[*Client]bool
	Register     chan *Client
	Unregister   chan *Client
	Inbound      chan *Message
	boardService *service.BoardService
	mu           sync.RWMutex
}

type HubManager struct {
	Rooms        map[string]*Hub
	boardService *service.BoardService
	mu           sync.RWMutex
}

func NewHubManager(boardService *service.BoardService) *HubManager {
	return &HubManager{
		Rooms:        make(map[string]*Hub),
		boardService: boardService,
	}
}

func (hm *HubManager) GetOrCreateHub(boardID uuid.UUID) *Hub {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	key := boardID.String()
	if hub, exists := hm.Rooms[key]; exists {
		return hub
	}

	hub := NewHub(boardID, hm.boardService)
	hm.Rooms[key] = hub
	go hub.Run()
	return hub
}

func (hm *HubManager) RemoveHubIfEmpty(boardID uuid.UUID) {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	key := boardID.String()
	if hub, exists := hm.Rooms[key]; exists {
		hub.mu.RLock()
		isEmpty := len(hub.Clients) == 0
		hub.mu.RUnlock()

		if isEmpty {
			delete(hm.Rooms, key)
		}
	}
}

type Client struct {
	ID      uuid.UUID
	UserID  uuid.UUID
	BoardID uuid.UUID
	Hub     *Hub
	Conn    *websocket.Conn
	Send    chan []byte
}

func NewHub(boardID uuid.UUID, boardService *service.BoardService) *Hub {
	return &Hub{
		BoardID:      boardID,
		Clients:      make(map[*Client]bool),
		Register:     make(chan *Client),
		Unregister:   make(chan *Client),
		Inbound:      make(chan *Message),
		boardService: boardService,
	}
}

type Message struct {
	Sender  uuid.UUID
	Content []byte
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func (c *Client) readPump(h *Hub) {
	defer func() {
		h.Unregister <- c
		c.Conn.Close()
	}()
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error for board %s: %v", h.BoardID, err)
			}
			break
		}
		h.Inbound <- &Message{
			Sender:  c.UserID,
			Content: message,
		}
	}
}

func (c *Client) writePump() {
	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Printf("WebSocket write error: %v", err)
			return
		}
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.Clients[client] = true
			h.mu.Unlock()

		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				close(client.Send)
			}
			h.mu.Unlock()

		case msg := <-h.Inbound:
			var payload struct {
				ID       string          `json:"id,omitempty"`
				Type     string          `json:"type"`
				Sender   string          `json:"sender,omitempty"`
				PageID   string          `json:"pageId,omitempty"`
				Payload  json.RawMessage `json:"payload,omitempty"`
			}
			if err := json.Unmarshal(msg.Content, &payload); err != nil {
				log.Printf("WebSocket JSON unmarshal error: %v", err)
				continue
			}

			// Persist elements to PostgreSQL database
			if h.boardService != nil && (payload.Type == "elements" || payload.Type == "draw" || payload.Type == "move" || payload.Type == "delete" || payload.Type == "clear") {
				var elementsMsg model.Elements
				if err := json.Unmarshal(msg.Content, &elementsMsg); err == nil {
					go func(boardID uuid.UUID, pageID string, elements []model.Element) {
						ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
						defer cancel()
						if err := h.boardService.SavePageElementsService(ctx, boardID, pageID, elements); err != nil {
							log.Printf("Failed to save elements for board %s: %v", boardID, err)
						}
					}(h.BoardID, elementsMsg.PageID, elementsMsg.Elements)
				}
			}

			// Assign server cursor & persist to events log if it is a persistent event
			var broadcastBytes []byte = msg.Content
			if h.boardService != nil && payload.Type != "presence.cursor" && payload.Type != "cursor" {
				env := model.EventEnvelope{
					ID:        payload.ID,
					Type:      payload.Type,
					BoardID:   h.BoardID.String(),
					PageID:    payload.PageID,
					UserID:    msg.Sender.String(),
					CreatedAt: time.Now().UTC(),
					Payload:   msg.Content,
				}
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				cursor, err := h.boardService.SaveEventService(ctx, &env)
				cancel()
				if err != nil {
					log.Printf("Failed to save event to database log: %v", err)
				} else {
					env.Cursor = cursor
					if b, err := json.Marshal(env); err == nil {
						broadcastBytes = b
					}
				}
			}

			h.mu.RLock()
			for client := range h.Clients {
				if client.UserID == msg.Sender {
					continue
				}
				select {
				case client.Send <- broadcastBytes:
				default:
					close(client.Send)
					delete(h.Clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func ServeWS(hm *HubManager, w http.ResponseWriter, r *http.Request) {
	boardIDStr := r.PathValue("boardId")
	boardID, err := uuid.Parse(boardIDStr)
	if err != nil {
		http.Error(w, "Invalid board ID", http.StatusBadRequest)
		return
	}

	cursorStr := r.URL.Query().Get("cursor")
	var lastSeenCursor int64 = 0
	if cursorStr != "" {
		if val, err := strconv.ParseInt(cursorStr, 10, 64); err == nil {
			lastSeenCursor = val
		}
	}

	hub := hm.GetOrCreateHub(boardID)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, "Error upgrading connection to websocket", http.StatusBadRequest)
		return
	}

	client := &Client{
		ID:      uuid.New(),
		UserID:  uuid.New(),
		BoardID: boardID,
		Hub:     hub,
		Conn:    conn,
		Send:    make(chan []byte, 256),
	}

	// Send current board state to newly connected client so they receive all existing work
	if hub.boardService != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		boardData, err := hub.boardService.GetBoardByIDService(ctx, boardID.String())
		cancel()
		if err == nil {
			for _, page := range boardData.Board.Pages {
				if len(page.Elements) > 0 {
					syncMsg := model.Elements{
						Type:     "elements",
						PageID:   page.PageID.String(),
						Elements: page.Elements,
					}
					if msgBytes, err := json.Marshal(syncMsg); err == nil {
						client.Send <- msgBytes
					}
				}
			}
		}
	}

	// Replay missed events if client reconnected with a cursor
	if lastSeenCursor > 0 && hub.boardService != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		res, err := hub.boardService.GetEventsAfterService(ctx, boardID.String(), lastSeenCursor)
		cancel()
		if err == nil && len(res.Events) > 0 {
			for _, evt := range res.Events {
				if evtBytes, err := json.Marshal(evt); err == nil {
					client.Send <- evtBytes
				}
			}
		}
	}

	hub.Register <- client

	go client.readPump(hub)
	go client.writePump()
}

package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Hub struct {
	BoardID    uuid.UUID
	Clients    map[*Client]bool
	Register   chan *Client
	Unregister chan *Client
	Inbound    chan *Message
	mu         sync.RWMutex
}

type HubManager struct {
	Rooms map[string]*Hub
	mu    sync.RWMutex
}

func NewHubManager() *HubManager {
	return &HubManager{
		Rooms: make(map[string]*Hub),
	}
}

func (hm *HubManager) GetOrCreateHub(boardID uuid.UUID) *Hub {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	key := boardID.String()
	if hub, exists := hm.Rooms[key]; exists {
		return hub
	}

	hub := NewHub(boardID)
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

func NewHub(boardID uuid.UUID) *Hub {
	return &Hub{
		BoardID:    boardID,
		Clients:    make(map[*Client]bool),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Inbound:    make(chan *Message),
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
				Type   string `json:"type"`
				Sender string `json:"sender"`
				PageId string `json:"pageid"`
			}
			if err := json.Unmarshal(msg.Content, &payload); err != nil {
				log.Printf("WebSocket JSON unmarshal error: %v", err)
				continue
			}
			h.mu.RLock()
			for client := range h.Clients {
				if client.UserID == msg.Sender {
					continue
				}
				switch payload.Type {
				case "draw", "move", "delete", "cursor", "clear", "elements", "chat":
					select {
					case client.Send <- msg.Content:
					default:
						close(client.Send)
						delete(h.Clients, client)
					}
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
	hub.Register <- client

	go client.readPump(hub)
	go client.writePump()
}

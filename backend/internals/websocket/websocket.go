package websocket

import (
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
	Inbound    chan []byte
	mu         sync.RWMutex
}

type Client struct {
	ID      uuid.UUID
	UserID  uuid.UUID
	BoardID uuid.UUID
	Hub     *Hub
	Conn    *websocket.Conn
	Send    chan []byte
}

func NewHub() *Hub {
	return &Hub{
		BoardID:    uuid.New(),
		Clients:    make(map[*Client]bool),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
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
			delete(h.Clients, client)
			h.mu.Unlock()
		}
	}
}

func ServeWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, "Error upgrading connection to websocket", http.StatusBadRequest)
		return
	}

	client := &Client{
		ID:      uuid.New(),
		UserID:  uuid.New(),
		BoardID: hub.BoardID,
		Hub:     hub,
		Conn:    conn,
		Send:    make(chan []byte, 256),
	}
	hub.Register <- client
}

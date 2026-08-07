package websocket

import (
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
				log.Print("Unable to read message")
				return
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
			log.Print("Unable to write message")
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
			delete(h.Clients, client)
			h.mu.Unlock()

		case msg := <-h.Inbound:
			h.mu.RLock()
			for client := range h.Clients {
				if client.UserID == msg.Sender {
					continue
				}
				client.Send <- msg.Content
			}
			h.mu.RUnlock()

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

	go client.readPump(hub)
	go client.writePump()
}

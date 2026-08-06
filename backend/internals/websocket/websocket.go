package websocket

import (
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Hub struct {
	BoardID    uuid.UUID
	Clients    map[*Client]bool
	Register   chan *Client
	Unregister chan *Client
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
		BoardID: uuid.New(),
		Clients: make(map[*Client]bool),
		Register: make(chan *Client),
		Unregister: make(chan *Client),
	}
}

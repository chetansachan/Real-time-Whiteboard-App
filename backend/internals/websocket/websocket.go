package websocket

import (
	"sync"

	"github.com/google/uuid"
)

type Hub struct {
	BoardID    uuid.UUID
	Clients    map[*Client]bool
	Register   chan *Client
	Unregister chan *Client
	mu         sync.RWMutex
}

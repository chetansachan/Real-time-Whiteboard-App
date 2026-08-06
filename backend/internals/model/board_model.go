package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Page struct {
	PageID uuid.UUID `json:"pageId"`
	Name   string    `json:"name"`
}

type Board struct {
	BoardID   uuid.UUID  `json:"boardId"`
	Title     string     `json:"title"`
	Pages     []Page     `json:"pages"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

type Boards struct {
	Boards []Board `json:"boards"`
}

type Hub struct {
	BoardID    string
	Clients    map[*Client]bool
	Register   chan *Client
	Unregister chan *Client
}

type Client struct {
	ID      string
	UserID  string
	BoardID string
	Hub     *Hub
	Conn    *websocket.Conn
	Send    chan []byte
}

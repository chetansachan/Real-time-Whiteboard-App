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

type Client struct {
	ID      uuid.UUID
	UserID  uuid.UUID
	BoardID uuid.UUID
	Hub     *Hub
	Conn    *websocket.Conn
	Send    chan []byte
}

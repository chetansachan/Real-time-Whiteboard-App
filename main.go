package main

import (
	"time"

	"github.com/google/uuid"
)

type Page struct {
	ID   uuid.UUID `json:"pageId"`
	PageNo int       `json:"pageno"`
}

type Board struct {
	ID        uuid.UUID `json:"boardId"`
	Title     string    `json:"title"`
	Pages     []Page    `json:"pages"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

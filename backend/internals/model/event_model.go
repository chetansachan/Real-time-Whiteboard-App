package model

import (
	"encoding/json"
	"time"
)

type EventEnvelope struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	BoardID   string          `json:"boardId"`
	PageID    string          `json:"pageId,omitempty"`
	ClientID  string          `json:"clientId,omitempty"`
	UserID    string          `json:"userId,omitempty"`
	Cursor    int64           `json:"cursor"`
	CreatedAt time.Time       `json:"createdAt"`
	Payload   json.RawMessage `json:"payload"`
}

type EventListResponse struct {
	Events []EventEnvelope `json:"events"`
	Cursor int64           `json:"cursor"`
}

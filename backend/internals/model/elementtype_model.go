package model

import "encoding/json"

type Element = json.RawMessage

type Elements struct {
	Type     string            `json:"type"`
	Sender   string            `json:"sender"`
	PageID   string            `json:"pageId,omitempty"`
	Elements []json.RawMessage `json:"elements"`
}

package model

import (
	"github.com/google/uuid"
)

type Line struct {
	Color      string    `json:"color"`
	Fill       string    `json:"fill"`
	Height     int       `json:"height"`
	ID         uuid.UUID `json:"id"`
	IsTemplate bool      `json:"is_template"`
	Size       int       `json:"size"`
	Type       string    `json:"type"`
	Width      int       `json:"width"`
	X1         float64   `json:"x1"`
	Y1         float64   `json:"y1"`
}

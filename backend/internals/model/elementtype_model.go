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
	X          float64   `json:"x"`
	Y          float64   `json:"y"`
}

type Stroke struct {
	Color      string    `json:"color"`
	ID         uuid.UUID `json:"id"`
	IsTemplate bool      `json:"is_template"`
	Size       int       `json:"size"`
	Type       string    `json:"type"`
	Points     []Point   `json:"points"`
}

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

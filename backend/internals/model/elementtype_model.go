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

type Rectangle struct {
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

type Circle struct {
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

type Text struct {
	Color      string    `json:"color"`
	ID         uuid.UUID `json:"id"`
	IsTemplate bool      `json:"is_template"`
	Size       int       `json:"size"`
	Text       string    `json:"text"`
	Type       string    `json:"type"`
	Width      int       `json:"width"`
	X          float64   `json:"x"`
	Y          float64   `json:"y"`
}

type Sticky struct {
	Color      string    `json:"color"`
	Fill       string    `json:"fill"`
	Height     int       `json:"height"`
	ID         uuid.UUID `json:"id"`
	IsTemplate bool      `json:"is_template"`
	Text       string    `json:"text"`
	TextColor  string    `json:"textcolor"`
	Size       int       `json:"size"`
	Type       string    `json:"type"`
	Width      int       `json:"width"`
	X          float64   `json:"x"`
	Y          float64   `json:"y"`
}

type Element struct {
	Type       string    `json:"type"`
	ID         uuid.UUID `json:"id"`
	Color      string    `json:"color"`
	IsTemplate bool      `json:"is_template"`
	Size       int       `json:"size"`
	X          float64   `json:"x"`
	Y          float64   `json:"y"`
	Width      int       `json:"width,omitempty"`
	Height     int       `json:"height,omitempty"`
	Fill       string    `json:"fill,omitempty"`
	Text       string    `json:"text,omitempty"`
	TextColor  string    `json:"textcolor,omitempty"`
	Points     []Point   `json:"points,omitempty"`
}

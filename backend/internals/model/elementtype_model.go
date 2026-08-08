package model

import (
	"github.com/google/uuid"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
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

type Root struct {
	Type     string    `json:"type"`
	Sender 	 string	   `json:"sender"`	
	Elements []Element `json:"elements"`
}
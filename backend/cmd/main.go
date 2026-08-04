package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type Page struct {
	PageID uuid.UUID `json:"pageid"`
	Name   string    `json:"name"`
}

type Board struct {
	BoardID   string    `json:"board"`
	Title     string    `json:"title"`
	Pages     []Page    `json:"pages"`
	CreatedAt time.Time `json:"createdat"`
	UpdatedAt time.Time `json:"updatedat,omitempty"`
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello world"))
	})

	fmt.Println("Server running on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal("Error Starting Server")
	}
}

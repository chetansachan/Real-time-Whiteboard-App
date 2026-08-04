package main

import (
	"encoding/json"
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
	BoardID   uuid.UUID `json:"board"`
	Title     string    `json:"title"`
	Pages     []Page    `json:"pages"`
	CreatedAt time.Time `json:"createdat"`
	UpdatedAt time.Time `json:"updatedat,omitempty"`
}

func createBoard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title string `json:"title"`
	}

	if r.Body != nil{
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Error Invalid JSON", http.StatusBadRequest)
		return
	}
	}

	if req.Title == "" {
		req.Title = "Unnamed Board"
	}

	board := Board{
		BoardID: uuid.New(),
		Title: req.Title,
		Pages: []Page{
			{
				PageID: uuid.New(),
				Name: "1",
			},
		},
		CreatedAt: time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(board)
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello world"))
	})
	mux.HandleFunc("POST /api/boards", createBoard)

	fmt.Println("Server running on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal("Error Starting Server")
	}
}

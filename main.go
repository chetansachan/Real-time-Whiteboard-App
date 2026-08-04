package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type Page struct {
	ID   uuid.UUID `json:"pageId"`
	Name string    `json:"name"`
}

type Board struct {
	ID        uuid.UUID `json:"boardId"`
	Title     string    `json:"title"`
	Pages     []Page    `json:"pages"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

func createWhiteboard(w http.ResponseWriter, r *http.Request) {

	// check the method of the req is it post or not
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	// create a empty post req payload
	var req struct {
		Title string `json:"title"`
	}

	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			http.Error(w, "Invalid JSON Value", http.StatusBadRequest)
			return
		}
	}

	if req.Title == "" {
		req.Title = "Unnamed Board"
	}

	// create a Board
	board := Board{
		ID:    uuid.New(),
		Title: req.Title,
		Pages: []Page{
			{
				ID:   uuid.New(),
				Name: "1",
			},
		},
		CreatedAt: time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(board); err != nil {
		http.Error(w, "Error Encoding data", http.StatusInternalServerError)
		return
	}
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/boards", createWhiteboard)

	log.Println("Server is listening on port 8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatalf("Error starting server: %v", err)
	}
}

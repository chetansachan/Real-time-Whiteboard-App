package controllers

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"realtime-whiteboard/internals/model"

	"github.com/google/uuid"
)

type BoardController struct{}

func NewBoardController() *BoardController {
	return &BoardController{}
}

func (c *BoardController) CreateBoard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title string `json:"title"`
	}

	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			http.Error(w, "Error Invalid JSON", http.StatusBadRequest)
			return
		}
	}

	if req.Title == "" {
		req.Title = "Unnamed Board"
	}

	board := model.Board{
		BoardID: uuid.New(),
		Title:   req.Title,
		Pages: []model.Page{
			{
				PageID: uuid.New(),
				Name:   "1",
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

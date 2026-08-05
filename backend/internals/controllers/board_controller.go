package controllers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"realtime-whiteboard/internals/service"
)

type BoardController struct {
	boardService *service.BoardService
}

func NewBoardController(boardService *service.BoardService) *BoardController {
	return &BoardController{boardService: boardService}
}

func (c *BoardController) CreateBoardController(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	// 1. Decode JSON directly into service.CreateBoardRequest
	var req service.CreateBoardRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			http.Error(w, "Error Invalid JSON", http.StatusBadRequest)
			return
		}
	}

	// 2. Pass request to service for validation & board creation
	board, err := c.boardService.CreateBoardService(r.Context(), req)
	if err != nil {
		if errors.Is(err, service.ErrTitleTooLong) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// 3. Encode response board to JSON
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(board); err != nil {
		http.Error(w, "Error Encoding response data", http.StatusInternalServerError)
		return
	}
}

func (c *BoardController) GetBoardByIDController(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	boardWithSnapshot, err := c.boardService.GetBoardByIDService(r.Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrBoardNotFound) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(boardWithSnapshot); err != nil {
		http.Error(w, "Error Encoding response data", http.StatusInternalServerError)
		return
	}
}

// Package controllers translates HTTP requests into service calls and
// shapes the JSON response. Each handler is responsible for binding the
// request, mapping domain errors to status codes, and serializing the
// response. No business logic lives here.
package controllers

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"realtime-whiteboard/internals/middleware"
	"realtime-whiteboard/internals/model"
	"realtime-whiteboard/internals/service"
)

// BoardController is the HTTP entry point for board operations.
type BoardController struct {
	boardService *service.BoardService
	logger       *slog.Logger
}

// NewBoardController returns a wired-up controller.
func NewBoardController(svc *service.BoardService, logger *slog.Logger) *BoardController {
	return &BoardController{boardService: svc, logger: logger}
}

// CreateBoard handles POST /api/boards.
func (c *BoardController) CreateBoard(w http.ResponseWriter, r *http.Request) {
	var req service.CreateBoardRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}

	board, err := c.boardService.CreateBoardService(r.Context(), req)
	if err != nil {
		writeServiceError(w, c.logger, r, err, "create board failed")
		return
	}
	writeJSON(w, http.StatusCreated, board)
}

// GetBoard handles GET /api/boards/{id}.
func (c *BoardController) GetBoard(w http.ResponseWriter, r *http.Request) {
	board, err := c.boardService.GetBoardByIDService(r.Context(), r.PathValue("id"))
	if err != nil {
		writeServiceError(w, c.logger, r, err, "load board failed")
		return
	}
	writeJSON(w, http.StatusOK, board)
}

// UpdateBoard handles PATCH /api/boards/{id}.
func (c *BoardController) UpdateBoard(w http.ResponseWriter, r *http.Request) {
	var req service.CreateBoardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	board, err := c.boardService.UpdateBoardByIDService(r.Context(), r.PathValue("id"), req.Title)
	if err != nil {
		writeServiceError(w, c.logger, r, err, "update board failed")
		return
	}
	writeJSON(w, http.StatusOK, board)
}

// AddPage handles POST /api/boards/{id}/pages.
func (c *BoardController) AddPage(w http.ResponseWriter, r *http.Request) {
	var p model.Page
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	board, err := c.boardService.AddPageByIDService(r.Context(), r.PathValue("id"), p.Name)
	if err != nil {
		writeServiceError(w, c.logger, r, err, "add page failed")
		return
	}
	writeJSON(w, http.StatusOK, board)
}

// ListBoards handles GET /api/boards.
func (c *BoardController) ListBoards(w http.ResponseWriter, r *http.Request) {
	boards, err := c.boardService.GetAllBoardsService(r.Context())
	if err != nil {
		writeServiceError(w, c.logger, r, err, "list boards failed")
		return
	}
	writeJSON(w, http.StatusOK, boards)
}

// DeleteBoard handles DELETE /api/boards/{id}.
func (c *BoardController) DeleteBoard(w http.ResponseWriter, r *http.Request) {
	if err := c.boardService.DeleteBoardByIdService(r.Context(), r.PathValue("id")); err != nil {
		writeServiceError(w, c.logger, r, err, "delete board failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetEventsAfter handles GET /api/boards/{id}/events?after=N.
func (c *BoardController) GetEventsAfter(w http.ResponseWriter, r *http.Request) {
	after := int64(0)
	if v := r.URL.Query().Get("after"); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil && parsed > 0 {
			after = parsed
		}
	}
	res, err := c.boardService.GetEventsAfterService(r.Context(), r.PathValue("id"), after)
	if err != nil {
		writeServiceError(w, c.logger, r, err, "load events failed")
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// SavePageElements handles PUT /api/boards/{id}/pages/{pageId}/elements.
// The body is the complete element array as JSON. This provides a
// synchronous, reliable alternative to the WebSocket persist path so
// clients can guarantee durability (e.g. after an erase) without racing
// against async WS goroutines.
func (c *BoardController) SavePageElements(w http.ResponseWriter, r *http.Request) {
	boardIDStr := r.PathValue("id")
	pageIDStr := r.PathValue("pageId")

	boardID, err := uuid.Parse(boardIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid board id")
		return
	}

	var elements []model.Element
	if err := json.NewDecoder(r.Body).Decode(&elements); err != nil {
		// Allow an empty body to mean "clear all elements".
		elements = []model.Element{}
	}
	if elements == nil {
		elements = []model.Element{}
	}

	if err := c.boardService.SavePageElementsService(r.Context(), boardID, pageIDStr, elements); err != nil {
		writeServiceError(w, c.logger, r, err, "save elements failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Healthz is a tiny liveness probe.
func (c *BoardController) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// writeJSON serializes v as JSON with the supplied status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError is the consistent 4xx/5xx shape: plain text body.
func writeError(w http.ResponseWriter, status int, msg string) {
	http.Error(w, msg, status)
}

// writeServiceError maps a service error to the right HTTP status and
// logs unexpected ones. Known client errors are returned with no log
// noise; everything else is treated as a 500.
func writeServiceError(w http.ResponseWriter, logger *slog.Logger, r *http.Request, err error, contextMsg string) {
	requestID := middleware.RequestIDFromContext(r.Context())
	switch {
	case errors.Is(err, service.ErrBoardNotFound), errors.Is(err, service.ErrInvalidID):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrTitleTooLong),
		errors.Is(err, service.ErrTitleInvalid),
		errors.Is(err, service.ErrPageNameRequired),
		errors.Is(err, service.ErrPageNameTooLong):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		logger.Error(contextMsg,
			slog.String("request_id", requestID),
			slog.String("error", err.Error()),
		)
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

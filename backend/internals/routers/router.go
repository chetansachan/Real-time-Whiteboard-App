// Package routers wires HTTP routes to controllers and applies the
// production middleware stack (recovery, request id, access log, CORS,
// timeout).
package routers

import (
	"log/slog"
	"net/http"

	"realtime-whiteboard/internals/config"
	"realtime-whiteboard/internals/controllers"
	"realtime-whiteboard/internals/middleware"
	"realtime-whiteboard/internals/repository"
	"realtime-whiteboard/internals/service"
	"realtime-whiteboard/internals/websocket"
)

// SetupRouter builds the full HTTP handler. The order of middleware is:
// recovery (outermost) -> request id -> access log -> CORS -> timeout ->
// handler.
func SetupRouter(cfg *config.Config, pool repository.BoardRepository, logger *slog.Logger) http.Handler {
	boardService := service.NewBoardService(pool)
	boardController := controllers.NewBoardController(boardService, logger)

	hubManager := websocket.NewHubManager(boardService, logger)
	wsCfg := websocket.NewConfig()
	wsCfg.ReadLimit = cfg.WSReadLimit
	wsCfg.WriteWait = cfg.WSWriteWait

	wsHandler := func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWS(hubManager, wsCfg, logger, w, r)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/boards", boardController.CreateBoard)
	mux.HandleFunc("GET /api/boards/{id}", boardController.GetBoard)
	mux.HandleFunc("PATCH /api/boards/{id}", boardController.UpdateBoard)
	mux.HandleFunc("DELETE /api/boards/{id}", boardController.DeleteBoard)
	mux.HandleFunc("GET /api/boards", boardController.ListBoards)
	mux.HandleFunc("POST /api/boards/{id}/pages", boardController.AddPage)
	mux.HandleFunc("GET /api/boards/{id}/events", boardController.GetEventsAfter)
	// --- Elements snapshot (synchronous HTTP persist, no WS race) ---
	mux.HandleFunc("PUT /api/boards/{id}/pages/{pageId}/elements", boardController.SavePageElements)
	mux.HandleFunc("GET /ws/boards/{boardId}/join", wsHandler)
	mux.HandleFunc("GET /healthz", boardController.Healthz)

	handler := middleware.Recovery(logger)(
		middleware.RequestID(
			middleware.AccessLog(logger)(
				middleware.CORS(cfg.AllowedOrigins)(
					middleware.Timeout(cfg.RequestTimeout)(mux),
				),
			),
		),
	)
	return handler
}

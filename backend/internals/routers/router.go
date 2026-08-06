package routers

import (
	"net/http"

	"realtime-whiteboard/internals/controllers"
	"realtime-whiteboard/internals/repository"
	"realtime-whiteboard/internals/service"

	"github.com/jackc/pgx/v5/pgxpool"
)

func SetupRouter(pool *pgxpool.Pool) http.Handler {
	mux := http.NewServeMux()

	boardRepo := repository.NewBoardRepository(pool)
	boardService := service.NewBoardService(boardRepo)
	boardController := controllers.NewBoardController(boardService)

	mux.HandleFunc("POST /api/boards", boardController.CreateBoardController)
	mux.HandleFunc("GET /api/boards/{id}", boardController.GetBoardByIDController)
	mux.HandleFunc("PATCH /api/boards/{id}", boardController.UpdateBoardByIDController)
	mux.HandleFunc("POST /api/boards/{id}/pages", boardController.AddPageByIDController)
	mux.HandleFunc("GET /api/boards", boardController.GetAllBoardsContoller)
	mux.HandleFunc("DELETE /api/boards/{id}", boardController.DeleteBoardByIdController)
	return withCORS(mux)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:5173")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Command realtime-whiteboard is the HTTP entry point for the API + WS
// service. It loads configuration, opens the database pool, and serves
// traffic until it receives a shutdown signal, at which point it drains
// in-flight requests before exiting.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"realtime-whiteboard/internals/config"
	"realtime-whiteboard/internals/database"
	"realtime-whiteboard/internals/logger"
	"realtime-whiteboard/internals/repository"
	"realtime-whiteboard/internals/routers"
)

func main() {
	if err := run(); err != nil {
		// Use the default logger here because the application logger may
		// not be set yet.
		slog.Error("fatal", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

func run() error {
	log := logger.Init()
	log.Info("starting", slog.String("service", "realtime-whiteboard"))

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log.Info("config_loaded", slog.String("config", cfg.String()))

	startupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := database.Connect(startupCtx, cfg.DatabaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()
	log.Info("database_ready")

	repo := repository.NewPostgresBoardRepository(pool)
	handler := routers.SetupRouter(cfg, repo, log)

	srv := &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
		ErrorLog:     slog.NewLogLogger(log.Handler(), slog.LevelError),
	}

	// Run the server in the background so we can wait for a signal.
	serverErr := make(chan error, 1)
	go func() {
		log.Info("http_listen", slog.String("addr", cfg.HTTPAddr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
		close(serverErr)
	}()

	// Wait for either a signal or a fatal server error.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-stop:
		log.Info("shutdown_signal", slog.String("signal", sig.String()))
	case err := <-serverErr:
		if err != nil {
			return err
		}
	}

	// Give in-flight requests up to ShutdownTimeout to finish, then cancel
	// them. Anything still in flight after that gets a 503.
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancelShutdown()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown_failed", slog.String("error", err.Error()))
		return err
	}
	log.Info("shutdown_complete")
	return nil
}

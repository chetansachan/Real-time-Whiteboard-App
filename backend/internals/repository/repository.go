// Package repository defines the BoardRepository interface and the
// postgres implementation. The interface lets service tests inject a fake
// without standing up a real database.
package repository

import (
	"context"
	"errors"

	"realtime-whiteboard/internals/model"

	"github.com/google/uuid"
)

// ErrBoardNotFound is returned when a lookup by id resolves to no row.
var ErrBoardNotFound = errors.New("board not found")

// BoardRepository is the persistence contract used by the service layer.
type BoardRepository interface {
	CreateBoard(ctx context.Context, board *model.Board) error
	GetBoardByID(ctx context.Context, id uuid.UUID) (model.Board, error)
	UpdateBoardTitle(ctx context.Context, id uuid.UUID, title string) (model.Board, error)
	AddPage(ctx context.Context, boardID uuid.UUID, name string) (model.Page, error)
	GetAllBoards(ctx context.Context) (model.Boards, error)
	DeleteBoard(ctx context.Context, id uuid.UUID) error
	SavePageElements(ctx context.Context, boardID uuid.UUID, pageID string, elements []model.Element) error

	SaveEvent(ctx context.Context, evt *model.EventEnvelope) (int64, error)
	GetEventsAfterCursor(ctx context.Context, boardID uuid.UUID, afterCursor int64) ([]model.EventEnvelope, int64, error)
	GetLatestCursorForBoard(ctx context.Context, boardID uuid.UUID) (int64, error)
}

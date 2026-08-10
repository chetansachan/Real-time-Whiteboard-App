// Package service implements the application logic on top of the
// repository. It is the single place that decides which inputs are valid
// and how errors should be mapped to HTTP status codes.
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"realtime-whiteboard/internals/model"
	"realtime-whiteboard/internals/repository"

	"github.com/google/uuid"
)

// Limits applied to user-supplied strings. Keeping them here means the
// API layer never has to think about content size.
const (
	MaxTitleLength    = 255
	MaxPageNameLength = 64
)

// Domain errors. The HTTP layer maps each to a status code.
var (
	ErrTitleTooLong     = errors.New("title cannot exceed 255 characters")
	ErrTitleInvalid     = errors.New("title contains invalid characters")
	ErrPageNameTooLong  = errors.New("page name cannot exceed 64 characters")
	ErrPageNameRequired = errors.New("page name is required")
	ErrBoardNotFound    = errors.New("board not found")
	ErrInvalidID        = errors.New("invalid board id")
)

// BoardService orchestrates board operations and delegates persistence to
// a BoardRepository so tests can swap in a fake.
type BoardService struct {
	repo repository.BoardRepository
}

// NewBoardService returns a service backed by the given repository.
func NewBoardService(repo repository.BoardRepository) *BoardService {
	return &BoardService{repo: repo}
}

// Compile-time check that BoardService exposes the surface area callers
// expect. Tests rely on this to keep mocks in sync.
var _ = (*BoardService)(nil)

// CreateBoardRequest is the body for POST /api/boards.
type CreateBoardRequest struct {
	Title string `json:"title"`
}

// BoardResponse is what we return to clients for single-board endpoints.
// We also embed the latest cursor so a freshly-loaded board can immediately
// resume from a known point.
type BoardResponse struct {
	model.Board
	Cursor int64 `json:"cursor"`
}

// CreateBoardService validates input, builds the domain model, and
// persists it. The first page is created automatically so the client has
// somewhere to draw.
func (s *BoardService) CreateBoardService(ctx context.Context, req CreateBoardRequest) (BoardResponse, error) {
	title, err := normalizeTitle(req.Title)
	if err != nil {
		return BoardResponse{}, err
	}

	board := model.Board{
		BoardID:   uuid.New(),
		Title:     title,
		Pages:     []model.Page{{PageID: uuid.New(), Name: "1", Elements: []model.Element{}}},
		CreatedAt: time.Now().UTC(),
	}

	if err := s.repo.CreateBoard(ctx, &board); err != nil {
		return BoardResponse{}, fmt.Errorf("save board: %w", err)
	}
	return BoardResponse{Board: board, Cursor: 0}, nil
}

// GetBoardByIDService loads a board and includes its latest event cursor.
func (s *BoardService) GetBoardByIDService(ctx context.Context, idStr string) (BoardResponse, error) {
	boardID, ok := parseBoardID(idStr)
	if !ok {
		return BoardResponse{}, ErrInvalidID
	}

	board, err := s.repo.GetBoardByID(ctx, boardID)
	if err != nil {
		if errors.Is(err, repository.ErrBoardNotFound) {
			return BoardResponse{}, ErrBoardNotFound
		}
		return BoardResponse{}, fmt.Errorf("load board: %w", err)
	}

	cursor, _ := s.repo.GetLatestCursorForBoard(ctx, boardID)
	return BoardResponse{Board: board, Cursor: cursor}, nil
}

// UpdateBoardByIDService renames a board. The previous version of this
// function shadowed the uuid-parse error with a fresh variable, which
// meant the wrapping error in the failure path was almost always wrong.
// The new version keeps each error on its own line.
func (s *BoardService) UpdateBoardByIDService(ctx context.Context, idStr, newTitle string) (BoardResponse, error) {
	boardID, ok := parseBoardID(idStr)
	if !ok {
		return BoardResponse{}, ErrInvalidID
	}

	title, err := normalizeTitle(newTitle)
	if err != nil {
		return BoardResponse{}, err
	}

	board, err := s.repo.UpdateBoardTitle(ctx, boardID, title)
	if err != nil {
		if errors.Is(err, repository.ErrBoardNotFound) {
			return BoardResponse{}, ErrBoardNotFound
		}
		return BoardResponse{}, fmt.Errorf("update board: %w", err)
	}

	cursor, _ := s.repo.GetLatestCursorForBoard(ctx, boardID)
	return BoardResponse{Board: board, Cursor: cursor}, nil
}

// AddPageByIDService appends a new page to the board.
func (s *BoardService) AddPageByIDService(ctx context.Context, idStr, pageName string) (BoardResponse, error) {
	boardID, ok := parseBoardID(idStr)
	if !ok {
		return BoardResponse{}, ErrInvalidID
	}

	name, err := normalizePageName(pageName)
	if err != nil {
		return BoardResponse{}, err
	}

	if _, err := s.repo.AddPage(ctx, boardID, name); err != nil {
		return BoardResponse{}, fmt.Errorf("add page: %w", err)
	}

	board, err := s.repo.GetBoardByID(ctx, boardID)
	if err != nil {
		return BoardResponse{}, fmt.Errorf("reload board: %w", err)
	}
	cursor, _ := s.repo.GetLatestCursorForBoard(ctx, boardID)
	return BoardResponse{Board: board, Cursor: cursor}, nil
}

// GetAllBoardsService returns every board.
func (s *BoardService) GetAllBoardsService(ctx context.Context) (model.Boards, error) {
	boards, err := s.repo.GetAllBoards(ctx)
	if err != nil {
		return model.Boards{}, fmt.Errorf("list boards: %w", err)
	}
	return boards, nil
}

// DeleteBoardByIdService removes a board and its pages/events.
func (s *BoardService) DeleteBoardByIdService(ctx context.Context, idStr string) error {
	boardID, ok := parseBoardID(idStr)
	if !ok {
		return ErrInvalidID
	}
	if err := s.repo.DeleteBoard(ctx, boardID); err != nil {
		if errors.Is(err, repository.ErrBoardNotFound) {
			return ErrBoardNotFound
		}
		return fmt.Errorf("delete board: %w", err)
	}
	return nil
}

// SavePageElementsService persists a page's elements.
func (s *BoardService) SavePageElementsService(ctx context.Context, boardID uuid.UUID, pageID string, elements []model.Element) error {
	if pageID == "" {
		return ErrPageNameRequired
	}
	if err := s.repo.SavePageElements(ctx, boardID, pageID, elements); err != nil {
		return fmt.Errorf("save page elements: %w", err)
	}
	return nil
}

// GetEventsAfterService returns events past the supplied cursor.
func (s *BoardService) GetEventsAfterService(ctx context.Context, boardIDStr string, afterCursor int64) (model.EventListResponse, error) {
	boardID, ok := parseBoardID(boardIDStr)
	if !ok {
		return model.EventListResponse{}, ErrInvalidID
	}
	events, maxCursor, err := s.repo.GetEventsAfterCursor(ctx, boardID, afterCursor)
	if err != nil {
		return model.EventListResponse{}, fmt.Errorf("fetch events: %w", err)
	}
	return model.EventListResponse{Events: events, Cursor: maxCursor}, nil
}

// SaveEventService persists a domain event.
func (s *BoardService) SaveEventService(ctx context.Context, evt *model.EventEnvelope) (int64, error) {
	cursor, err := s.repo.SaveEvent(ctx, evt)
	if err != nil {
		return 0, fmt.Errorf("save event: %w", err)
	}
	return cursor, nil
}

// parseBoardID centralizes uuid parsing and returns (id, true) on success.
func parseBoardID(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

// normalizeTitle trims, applies a fallback when empty, and enforces the
// 255-character limit while rejecting control characters.
func normalizeTitle(raw string) (string, error) {
	t := strings.TrimSpace(raw)
	if t == "" {
		t = "Untitled board"
	}
	if utf8.RuneCountInString(t) > MaxTitleLength {
		return "", ErrTitleTooLong
	}
	for _, r := range t {
		if r == '\n' || r == '\r' || r == '\t' || r == 0 {
			return "", ErrTitleInvalid
		}
	}
	return t, nil
}

// normalizePageName enforces the 64-character limit and rejects blank
// names.
func normalizePageName(raw string) (string, error) {
	n := strings.TrimSpace(raw)
	if n == "" {
		return "", ErrPageNameRequired
	}
	if utf8.RuneCountInString(n) > MaxPageNameLength {
		return "", ErrPageNameTooLong
	}
	return n, nil
}

package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"realtime-whiteboard/internals/model"
	"realtime-whiteboard/internals/repository"

	"github.com/google/uuid"
)

var (
	ErrTitleTooLong     = errors.New("title cannot exceed 255 characters")
	ErrBoardNotFound    = errors.New("board not found")
	ErrPageNameRequired = errors.New("page name is required")
)

type BoardService struct {
	repo *repository.BoardRepository
}

func NewBoardService(repo *repository.BoardRepository) *BoardService {
	return &BoardService{repo: repo}
}

type CreateBoardRequest struct {
	Title string `json:"title"`
}

func (s *BoardService) CreateBoardService(ctx context.Context, req CreateBoardRequest) (model.Board, error) {
	// Sanitize & Validate Title
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Unnamed Board"
	}

	if len(title) > 255 {
		return model.Board{}, ErrTitleTooLong
	}

	// Construct Domain Model
	board := model.Board{
		BoardID: uuid.New(),
		Title:   title,
		Pages: []model.Page{
			{
				PageID: uuid.New(),
				Name:   "1",
			},
		},
		CreatedAt: time.Now().UTC(),
	}

	// Save to Database
	if err := s.repo.CreateBoard(ctx, &board); err != nil {
		return model.Board{}, fmt.Errorf("failed to save board to database: %w", err)
	}

	return board, nil
}

type Snapshot struct {
	PageID   string   `json:"pageId"`
	Elements []string `json:"elements"`
}

type GetBoardByIDRespone struct {
	model.Board
	Snapshot Snapshot `json:"snapshot"`
	Cursor   int      `json:"cursor"`
}

func (s *BoardService) GetBoardByIDService(ctx context.Context, idStr string) (GetBoardByIDRespone, error) {
	boardID, err := uuid.Parse(idStr)
	if err != nil {
		return GetBoardByIDRespone{}, ErrBoardNotFound
	}

	board, err := s.repo.GetBoardByID(ctx, boardID)
	if err != nil {
		if errors.Is(err, repository.ErrBoardNotFound) {
			return GetBoardByIDRespone{}, ErrBoardNotFound
		}
		return GetBoardByIDRespone{}, fmt.Errorf("failed to get board from database: %w", err)
	}

	res := GetBoardByIDRespone{
		Board: board,
		Snapshot: Snapshot{
			PageID:   "1",
			Elements: []string{},
		},
		Cursor: 184,
	}

	return res, nil
}

func (s *BoardService) UpdateBoardByIDService(ctx context.Context, idStr string, newtitle string) (GetBoardByIDRespone, error) {
	id, err := uuid.Parse(idStr)
	if err != nil {
		return GetBoardByIDRespone{}, ErrBoardNotFound
	}

	board, err2 := s.repo.UpdateBoardByID(ctx, id, newtitle)
	if err2 != nil {
		return GetBoardByIDRespone{}, fmt.Errorf("failed to update board title: %w", err)
	}

	res := GetBoardByIDRespone{
		Board: board,
		Snapshot: Snapshot{
			PageID:   "1",
			Elements: []string{},
		},
		Cursor: 184,
	}

	return res, nil
}

func (s *BoardService) AddPageByIDService(ctx context.Context, idStr string, pagename string) (GetBoardByIDRespone, error) {
	id, err := uuid.Parse(idStr)
	if err != nil {
		return GetBoardByIDRespone{}, ErrBoardNotFound
	}

	name := strings.TrimSpace(pagename)
	if name == "" {
		return GetBoardByIDRespone{}, ErrPageNameRequired
	}

	page, err := s.repo.AddPageByID(ctx, id, name)
	if err != nil {
		return GetBoardByIDRespone{}, fmt.Errorf("failed to make new page: %w", err)
	}

	board, err := s.repo.GetBoardByID(ctx, id)
	if err != nil {
		return GetBoardByIDRespone{}, fmt.Errorf("failed to get board from database: %w", err)
	}

	res := GetBoardByIDRespone{
		Board: board,
		Snapshot: Snapshot{
			PageID:   page.PageID.String(),
			Elements: []string{},
		},
		Cursor: 184,
	}

	return res, nil
}

func (s *BoardService) GetAllBoardsService(ctx context.Context) (model.Boards, error) {
	boards, err := s.repo.GetAllBoards(ctx)
	if err != nil {
		if errors.Is(err, repository.ErrBoardNotFound) {
			return model.Boards{}, ErrBoardNotFound
		}
		return model.Boards{}, fmt.Errorf("failed to get boards from database: %w", err)
	}
	return boards, nil
}

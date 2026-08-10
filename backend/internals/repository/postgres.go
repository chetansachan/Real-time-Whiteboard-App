package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"realtime-whiteboard/internals/model"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresBoardRepository is the production implementation of
// BoardRepository backed by PostgreSQL via pgx.
type PostgresBoardRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresBoardRepository returns a repository bound to the given pool.
func NewPostgresBoardRepository(pool *pgxpool.Pool) *PostgresBoardRepository {
	return &PostgresBoardRepository{pool: pool}
}

// Compile-time check that we satisfy the interface.
var _ BoardRepository = (*PostgresBoardRepository)(nil)

// CreateBoard inserts a board and its initial pages inside a single
// transaction so a partial failure never leaves an orphan board row.
func (r *PostgresBoardRepository) CreateBoard(ctx context.Context, board *model.Board) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if board.CreatedAt.IsZero() {
		board.CreatedAt = time.Now().UTC()
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO boards (board_id, title, created_at, updated_at) VALUES ($1, $2, $3, NULL)`,
		board.BoardID, board.Title, board.CreatedAt,
	); err != nil {
		return fmt.Errorf("insert board: %w", err)
	}

	for i, page := range board.Pages {
		if page.PageID == uuid.Nil {
			page.PageID = uuid.New()
		}
		elements := page.Elements
		if elements == nil {
			elements = []model.Element{}
		}
		elementsJSON, err := json.Marshal(elements)
		if err != nil {
			return fmt.Errorf("marshal elements for page %d: %w", i, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO pages (page_id, board_id, name, elements, position) VALUES ($1, $2, $3, $4, $5)`,
			page.PageID, board.BoardID, page.Name, elementsJSON, i,
		); err != nil {
			return fmt.Errorf("insert page %d: %w", i, err)
		}
		board.Pages[i] = page
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// GetBoardByID returns the board with its pages, ordered by position then
// by page_id so the order is stable across calls.
func (r *PostgresBoardRepository) GetBoardByID(ctx context.Context, id uuid.UUID) (model.Board, error) {
	var b model.Board

	err := r.pool.QueryRow(ctx,
		`SELECT board_id, title, created_at, updated_at FROM boards WHERE board_id = $1`, id,
	).Scan(&b.BoardID, &b.Title, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Board{}, ErrBoardNotFound
	}
	if err != nil {
		return model.Board{}, fmt.Errorf("query board: %w", err)
	}

	rows, err := r.pool.Query(ctx,
		`SELECT page_id, name, elements FROM pages WHERE board_id = $1 ORDER BY position ASC, page_id ASC`, id,
	)
	if err != nil {
		return b, fmt.Errorf("query pages: %w", err)
	}
	defer rows.Close()

	b.Pages = []model.Page{}
	for rows.Next() {
		var p model.Page
		var elementsRaw []byte
		if err := rows.Scan(&p.PageID, &p.Name, &elementsRaw); err != nil {
			return b, fmt.Errorf("scan page: %w", err)
		}
		if len(elementsRaw) > 0 {
			_ = json.Unmarshal(elementsRaw, &p.Elements)
		}
		if p.Elements == nil {
			p.Elements = []model.Element{}
		}
		b.Pages = append(b.Pages, p)
	}
	if err := rows.Err(); err != nil {
		return b, fmt.Errorf("iterate pages: %w", err)
	}
	return b, nil
}

// UpdateBoardTitle changes the title and bumps updated_at, returning the
// freshly-read board (with pages) so callers can re-render without a
// second round-trip.
func (r *PostgresBoardRepository) UpdateBoardTitle(ctx context.Context, id uuid.UUID, title string) (model.Board, error) {
	var b model.Board
	err := r.pool.QueryRow(ctx,
		`UPDATE boards SET title = $1, updated_at = NOW() WHERE board_id = $2
		 RETURNING board_id, title, created_at, updated_at`,
		title, id,
	).Scan(&b.BoardID, &b.Title, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Board{}, ErrBoardNotFound
	}
	if err != nil {
		return model.Board{}, fmt.Errorf("update board: %w", err)
	}
	return r.GetBoardByID(ctx, id)
}

// AddPage appends a new page to a board at the end of the page list.
func (r *PostgresBoardRepository) AddPage(ctx context.Context, boardID uuid.UUID, name string) (model.Page, error) {
	page := model.Page{
		PageID:   uuid.New(),
		Name:     name,
		Elements: []model.Element{},
	}
	elementsJSON, err := json.Marshal(page.Elements)
	if err != nil {
		return model.Page{}, fmt.Errorf("marshal empty elements: %w", err)
	}

	var nextPos int
	if err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(position), -1) + 1 FROM pages WHERE board_id = $1`, boardID,
	).Scan(&nextPos); err != nil {
		return model.Page{}, fmt.Errorf("compute next position: %w", err)
	}

	if _, err := r.pool.Exec(ctx,
		`INSERT INTO pages (page_id, board_id, name, elements, position) VALUES ($1, $2, $3, $4, $5)`,
		page.PageID, boardID, page.Name, elementsJSON, nextPos,
	); err != nil {
		return model.Page{}, fmt.Errorf("insert page: %w", err)
	}
	return page, nil
}

// SavePageElements persists a page's elements. The pageID may be either a
// real UUID or a local-only id (e.g. "page-1" from a freshly created UI);
// the fallback uses the first page of the board so the client can still
// round-trip the data.
func (r *PostgresBoardRepository) SavePageElements(ctx context.Context, boardID uuid.UUID, pageID string, elements []model.Element) error {
	elementsJSON, err := json.Marshal(elements)
	if err != nil {
		return fmt.Errorf("marshal elements: %w", err)
	}

	if pid, parseErr := uuid.Parse(pageID); parseErr == nil {
		tag, err := r.pool.Exec(ctx,
			`UPDATE pages SET elements = $1 WHERE page_id = $2`, elementsJSON, pid,
		)
		if err == nil && tag.RowsAffected() > 0 {
			return nil
		}
	}

	if _, err := r.pool.Exec(ctx,
		`UPDATE pages SET elements = $1
		 WHERE board_id = $2 AND page_id = (
		   SELECT page_id FROM pages WHERE board_id = $2 ORDER BY position ASC, page_id ASC LIMIT 1
		 )`,
		elementsJSON, boardID,
	); err != nil {
		return fmt.Errorf("update page elements by board: %w", err)
	}
	return nil
}

// GetAllBoards returns every board, ordered most recent first.
func (r *PostgresBoardRepository) GetAllBoards(ctx context.Context) (model.Boards, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT board_id, title, created_at, updated_at FROM boards ORDER BY created_at DESC`,
	)
	if err != nil {
		return model.Boards{}, fmt.Errorf("query boards: %w", err)
	}
	defer rows.Close()

	result := model.Boards{Boards: []model.Board{}}
	for rows.Next() {
		var b model.Board
		if err := rows.Scan(&b.BoardID, &b.Title, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return model.Boards{}, fmt.Errorf("scan board: %w", err)
		}
		b.Pages = []model.Page{}
		result.Boards = append(result.Boards, b)
	}
	if err := rows.Err(); err != nil {
		return model.Boards{}, fmt.Errorf("iterate boards: %w", err)
	}
	// Stable client-side order: newest first, ties broken by title.
	sort.SliceStable(result.Boards, func(i, j int) bool {
		if result.Boards[i].CreatedAt.Equal(result.Boards[j].CreatedAt) {
			return result.Boards[i].Title < result.Boards[j].Title
		}
		return result.Boards[i].CreatedAt.After(result.Boards[j].CreatedAt)
	})
	return result, nil
}

// DeleteBoard removes a board; pages and events are cleaned up by the
// ON DELETE CASCADE foreign keys declared in the migrations.
func (r *PostgresBoardRepository) DeleteBoard(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM boards WHERE board_id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete board: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrBoardNotFound
	}
	return nil
}

// SaveEvent persists a single event row and updates the envelope in place
// with the assigned cursor and timestamp.
func (r *PostgresBoardRepository) SaveEvent(ctx context.Context, evt *model.EventEnvelope) (int64, error) {
	boardID, err := uuid.Parse(evt.BoardID)
	if err != nil {
		return 0, fmt.Errorf("invalid board id: %w", err)
	}

	var pageID *uuid.UUID
	if evt.PageID != "" {
		if pid, err := uuid.Parse(evt.PageID); err == nil {
			pageID = &pid
		}
	}

	var userID *uuid.UUID
	if evt.UserID != "" {
		if uid, err := uuid.Parse(evt.UserID); err == nil {
			userID = &uid
		}
	}

	payload := evt.Payload
	if len(payload) == 0 {
		payload = []byte("{}")
	}

	createdAt := evt.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	var cursor int64
	err = r.pool.QueryRow(ctx,
		`INSERT INTO events (board_id, page_id, user_id, type, payload, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING cursor`,
		boardID, pageID, userID, evt.Type, payload, createdAt,
	).Scan(&cursor)
	if err != nil {
		return 0, fmt.Errorf("insert event: %w", err)
	}
	evt.Cursor = cursor
	evt.CreatedAt = createdAt
	return cursor, nil
}

// GetEventsAfterCursor returns all events with cursor > afterCursor and
// the highest cursor seen.
func (r *PostgresBoardRepository) GetEventsAfterCursor(ctx context.Context, boardID uuid.UUID, afterCursor int64) ([]model.EventEnvelope, int64, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT event_id, board_id, page_id, user_id, cursor, type, payload, created_at
		 FROM events
		 WHERE board_id = $1 AND cursor > $2
		 ORDER BY cursor ASC`,
		boardID, afterCursor,
	)
	if err != nil {
		return nil, afterCursor, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	events := []model.EventEnvelope{}
	maxCursor := afterCursor
	for rows.Next() {
		var evt model.EventEnvelope
		var evtID, bID uuid.UUID
		var pID, uID *uuid.UUID
		var payloadBytes []byte
		if err := rows.Scan(&evtID, &bID, &pID, &uID, &evt.Cursor, &evt.Type, &payloadBytes, &evt.CreatedAt); err != nil {
			return nil, afterCursor, fmt.Errorf("scan event: %w", err)
		}
		evt.ID = evtID.String()
		evt.BoardID = bID.String()
		if pID != nil {
			evt.PageID = pID.String()
		}
		if uID != nil {
			evt.UserID = uID.String()
		}
		evt.Payload = payloadBytes
		if evt.Cursor > maxCursor {
			maxCursor = evt.Cursor
		}
		events = append(events, evt)
	}
	if err := rows.Err(); err != nil {
		return nil, afterCursor, fmt.Errorf("iterate events: %w", err)
	}
	return events, maxCursor, nil
}

// GetLatestCursorForBoard returns the latest cursor for the board, or 0
// if no events have been recorded yet.
func (r *PostgresBoardRepository) GetLatestCursorForBoard(ctx context.Context, boardID uuid.UUID) (int64, error) {
	var cursor int64
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(cursor), 0) FROM events WHERE board_id = $1`, boardID,
	).Scan(&cursor)
	if err != nil {
		return 0, fmt.Errorf("query latest cursor: %w", err)
	}
	return cursor, nil
}

package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"realtime-whiteboard/internals/model"
	"realtime-whiteboard/internals/repository"

	"github.com/google/uuid"
)

// fakeRepo is an in-memory BoardRepository for service-level tests.
// It does not enforce referential integrity; the service is the only
// authority for that.
type fakeRepo struct {
	boards        map[uuid.UUID]model.Board
	pages         map[uuid.UUID][]model.Page
	createErr     error
	updateErr     error
	notFoundAfter bool
	calls         []string
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		boards: map[uuid.UUID]model.Board{},
		pages:  map[uuid.UUID][]model.Page{},
	}
}

func (f *fakeRepo) record(name string) {
	f.calls = append(f.calls, name)
}

func (f *fakeRepo) CreateBoard(ctx context.Context, b *model.Board) error {
	f.record("CreateBoard")
	if f.createErr != nil {
		return f.createErr
	}
	f.boards[b.BoardID] = *b
	f.pages[b.BoardID] = append([]model.Page{}, b.Pages...)
	return nil
}

func (f *fakeRepo) GetBoardByID(ctx context.Context, id uuid.UUID) (model.Board, error) {
	f.record("GetBoardByID")
	b, ok := f.boards[id]
	if !ok {
		return model.Board{}, repository.ErrBoardNotFound
	}
	b.Pages = append([]model.Page{}, f.pages[id]...)
	return b, nil
}

func (f *fakeRepo) UpdateBoardTitle(ctx context.Context, id uuid.UUID, title string) (model.Board, error) {
	f.record("UpdateBoardTitle")
	if f.updateErr != nil {
		return model.Board{}, f.updateErr
	}
	if _, ok := f.boards[id]; !ok {
		return model.Board{}, repository.ErrBoardNotFound
	}
	b := f.boards[id]
	b.Title = title
	f.boards[id] = b
	b.Pages = append([]model.Page{}, f.pages[id]...)
	return b, nil
}

func (f *fakeRepo) AddPage(ctx context.Context, boardID uuid.UUID, name string) (model.Page, error) {
	f.record("AddPage")
	pages, ok := f.pages[boardID]
	if !ok {
		return model.Page{}, repository.ErrBoardNotFound
	}
	page := model.Page{PageID: uuid.New(), Name: name, Elements: []model.Element{}}
	f.pages[boardID] = append(pages, page)
	return page, nil
}

func (f *fakeRepo) GetAllBoards(ctx context.Context) (model.Boards, error) {
	f.record("GetAllBoards")
	out := model.Boards{Boards: make([]model.Board, 0, len(f.boards))}
	for _, b := range f.boards {
		out.Boards = append(out.Boards, b)
	}
	return out, nil
}

func (f *fakeRepo) DeleteBoard(ctx context.Context, id uuid.UUID) error {
	f.record("DeleteBoard")
	if _, ok := f.boards[id]; !ok {
		return repository.ErrBoardNotFound
	}
	delete(f.boards, id)
	delete(f.pages, id)
	return nil
}

func (f *fakeRepo) SavePageElements(ctx context.Context, boardID uuid.UUID, pageID string, elements []model.Element) error {
	f.record("SavePageElements")
	return nil
}

func (f *fakeRepo) SaveEvent(ctx context.Context, evt *model.EventEnvelope) (int64, error) {
	f.record("SaveEvent")
	evt.Cursor = 1
	return 1, nil
}

func (f *fakeRepo) GetEventsAfterCursor(ctx context.Context, boardID uuid.UUID, afterCursor int64) ([]model.EventEnvelope, int64, error) {
	f.record("GetEventsAfterCursor")
	return nil, afterCursor, nil
}

func (f *fakeRepo) GetLatestCursorForBoard(ctx context.Context, boardID uuid.UUID) (int64, error) {
	f.record("GetLatestCursorForBoard")
	return 0, nil
}

func TestCreateBoard_FallsBackToDefaultTitle(t *testing.T) {
	svc := NewBoardService(newFakeRepo())
	res, err := svc.CreateBoardService(context.Background(), CreateBoardRequest{Title: "   "})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Title != "Untitled board" {
		t.Errorf("expected default title, got %q", res.Title)
	}
	if len(res.Pages) != 1 {
		t.Errorf("expected a starter page, got %d pages", len(res.Pages))
	}
}

func TestCreateBoard_RejectsTooLongTitle(t *testing.T) {
	svc := NewBoardService(newFakeRepo())
	long := strings.Repeat("a", MaxTitleLength+1)
	_, err := svc.CreateBoardService(context.Background(), CreateBoardRequest{Title: long})
	if !errors.Is(err, ErrTitleTooLong) {
		t.Errorf("expected ErrTitleTooLong, got %v", err)
	}
}

func TestCreateBoard_RejectsControlCharsInTitle(t *testing.T) {
	svc := NewBoardService(newFakeRepo())
	_, err := svc.CreateBoardService(context.Background(), CreateBoardRequest{Title: "ok\ntitle"})
	if !errors.Is(err, ErrTitleInvalid) {
		t.Errorf("expected ErrTitleInvalid, got %v", err)
	}
}

func TestUpdateBoard_WrapsRepoError(t *testing.T) {
	// This is the regression test for the err/err2 bug. The previous
	// implementation shadowed the uuid-parse error with a local variable
	// and then formatted the *outer* err in the failure path, which would
	// wrap a nil err with the DB message. We verify that the wrapped
	// error contains the underlying DB error message.
	repo := newFakeRepo()
	repo.updateErr = errors.New("db connection refused")
	svc := NewBoardService(repo)

	_, err := svc.UpdateBoardByIDService(context.Background(), uuid.NewString(), "new title")
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "db connection refused") {
		t.Errorf("expected wrapped DB error, got %v", err)
	}
	if errors.Is(err, repository.ErrBoardNotFound) {
		t.Errorf("update must not be confused with not-found")
	}
}

func TestUpdateBoard_NotFound(t *testing.T) {
	svc := NewBoardService(newFakeRepo())
	_, err := svc.UpdateBoardByIDService(context.Background(), uuid.NewString(), "title")
	if !errors.Is(err, ErrBoardNotFound) {
		t.Errorf("expected ErrBoardNotFound, got %v", err)
	}
}

func TestUpdateBoard_InvalidID(t *testing.T) {
	svc := NewBoardService(newFakeRepo())
	_, err := svc.UpdateBoardByIDService(context.Background(), "not-a-uuid", "title")
	if !errors.Is(err, ErrInvalidID) {
		t.Errorf("expected ErrInvalidID, got %v", err)
	}
}

func TestGetBoard_HappyPath(t *testing.T) {
	repo := newFakeRepo()
	id := uuid.New()
	repo.boards[id] = model.Board{BoardID: id, Title: "demo"}
	repo.pages[id] = []model.Page{{PageID: uuid.New(), Name: "1"}}

	svc := NewBoardService(repo)
	res, err := svc.GetBoardByIDService(context.Background(), id.String())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Title != "demo" {
		t.Errorf("expected demo, got %q", res.Title)
	}
}

func TestAddPage_RejectsBlankName(t *testing.T) {
	svc := NewBoardService(newFakeRepo())
	_, err := svc.AddPageByIDService(context.Background(), uuid.NewString(), "   ")
	if !errors.Is(err, ErrPageNameRequired) {
		t.Errorf("expected ErrPageNameRequired, got %v", err)
	}
}

func TestDeleteBoard_NotFound(t *testing.T) {
	svc := NewBoardService(newFakeRepo())
	err := svc.DeleteBoardByIdService(context.Background(), uuid.NewString())
	if !errors.Is(err, ErrBoardNotFound) {
		t.Errorf("expected ErrBoardNotFound, got %v", err)
	}
}

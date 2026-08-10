import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addBoardPage, createBoard, deleteBoard as deleteBoardApi, getBoard, getBoards, updateBoardTitle } from "../services/boardApi.js";
import { mergeRemoteBoardMetadata } from "../utils/whiteboard.js";

export function useBoardsList({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["allBoards"],
    queryFn: getBoards,
    enabled,
    retry: 1,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false
  });
}

export function useBoardApi({ boardId, board, enabled = true, setBoard, setToast }) {
  const targetBoardId = boardId || board?.boardId;
  const queryClient = useQueryClient();

  // Keep setBoard in a ref so the boardQuery effect below has a stable
  // dependency and never fires in an infinite loop.
  const setBoardRef = useRef(setBoard);
  useEffect(() => {
    setBoardRef.current = setBoard;
  }, [setBoard]);

  const boardQuery = useQuery({
    queryKey: ["board", targetBoardId],
    queryFn: () => getBoard(targetBoardId),
    enabled: enabled && Boolean(targetBoardId),
    retry: 1,
    refetchOnWindowFocus: false
  });

  const createBoardMutation = useMutation({
    mutationFn: createBoard,
    onSuccess: (remoteBoard) => {
      setBoard((current) => mergeRemoteBoardMetadata(current, remoteBoard));
      queryClient.setQueryData(["board", remoteBoard.boardId], remoteBoard);
      queryClient.invalidateQueries({ queryKey: ["allBoards"] });
    }
  });

  const loadBoardMutation = useMutation({
    mutationFn: getBoard,
    onSuccess: (remoteBoard) => {
      setBoard((current) => mergeRemoteBoardMetadata(current, remoteBoard));
      queryClient.setQueryData(["board", remoteBoard.boardId], remoteBoard);
    },
    onError: () => {
      setToast?.("Could not load board");
    }
  });

  const updateTitleMutation = useMutation({
    mutationFn: ({ boardId, title }) => updateBoardTitle(boardId, title),
    onSuccess: (remoteBoard) => {
      setBoard((current) => mergeRemoteBoardMetadata(current, remoteBoard));
      queryClient.setQueryData(["board", remoteBoard.boardId], remoteBoard);
      queryClient.invalidateQueries({ queryKey: ["allBoards"] });
      setToast?.("Board title saved");
    },
    onError: () => {
      setToast?.("Could not save title");
    }
  });

  const addPageMutation = useMutation({
    mutationFn: ({ boardId, name }) => addBoardPage(boardId, name),
    onSuccess: (remoteBoard) => {
      setBoard((current) => mergeRemoteBoardMetadata(current, remoteBoard));
      queryClient.setQueryData(["board", remoteBoard.boardId], remoteBoard);
      queryClient.invalidateQueries({ queryKey: ["allBoards"] });
      setToast?.("Page saved to backend");
    },
    onError: () => {
      setToast?.("Backend unavailable, added local page");
    }
  });

  const deleteBoardMutation = useMutation({
    mutationFn: (boardId) => deleteBoardApi(boardId),
    onSuccess: (_, boardId) => {
      queryClient.invalidateQueries({ queryKey: ["allBoards"] });
      queryClient.removeQueries({ queryKey: ["board", boardId] });
      setToast?.("Board deleted");
    },
    onError: () => {
      setToast?.("Could not delete board");
    }
  });

  useEffect(() => {
    if (!boardQuery.data) return;
    // Use the ref so this effect never re-fires just because setBoard changed identity.
    setBoardRef.current((current) => mergeRemoteBoardMetadata(current, boardQuery.data));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardQuery.data]);

  const saveTitle = useCallback(() => {
    if (!board.boardId) {
      setToast?.("Create or load a board first");
      return;
    }
    updateTitleMutation.mutate({ boardId: board.boardId, title: board.title });
  }, [board.boardId, board.title, setToast, updateTitleMutation]);

  const createNewBoard = useCallback(
    async (title) => createBoardMutation.mutateAsync(title),
    [createBoardMutation]
  );

  const loadBoard = useCallback(
    async (boardId) => loadBoardMutation.mutateAsync(boardId),
    [loadBoardMutation]
  );

  const renameBoardTitle = useCallback(
    async (boardId, title) => updateTitleMutation.mutateAsync({ boardId, title }),
    [updateTitleMutation]
  );

  const addPage = useCallback(
    async (name) => {
      if (!board.boardId) {
        throw new Error("Backend board is not connected yet");
      }
      return addPageMutation.mutateAsync({ boardId: board.boardId, name });
    },
    [addPageMutation, board.boardId]
  );

  const deleteBoard = useCallback(
    async (boardId) => deleteBoardMutation.mutateAsync(boardId),
    [deleteBoardMutation]
  );

  const isSaving = createBoardMutation.isPending || loadBoardMutation.isPending || updateTitleMutation.isPending || addPageMutation.isPending || deleteBoardMutation.isPending;
  const isOffline = createBoardMutation.isError || loadBoardMutation.isError || updateTitleMutation.isError || addPageMutation.isError || boardQuery.isError || deleteBoardMutation.isError;
  const status = isSaving ? "saving" : isOffline ? "offline" : board.boardId ? "connected" : "connecting";
  const error =
    createBoardMutation.error?.message ||
    loadBoardMutation.error?.message ||
    updateTitleMutation.error?.message ||
    addPageMutation.error?.message ||
    deleteBoardMutation.error?.message ||
    boardQuery.error?.message ||
    "";

  return {
    addPage,
    createNewBoard,
    deleteBoard,
    error,
    isAddingPage: addPageMutation.isPending,
    isCreatingBoard: createBoardMutation.isPending,
    isDeletingBoard: deleteBoardMutation.isPending,
    isLoadingBoard: loadBoardMutation.isPending,
    isRenamingBoard: updateTitleMutation.isPending,
    isSavingTitle: updateTitleMutation.isPending,
    loadBoard,
    refetchBoard: boardQuery.refetch,
    renameBoardTitle,
    saveTitle,
    status
  };
}

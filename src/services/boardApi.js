const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function createBoard(title) {
  return request("/api/boards", {
    method: "POST",
    body: JSON.stringify({ title })
  });
}

export function getBoards() {
  return request("/api/boards");
}

export function getBoard(boardId) {
  return request(`/api/boards/${boardId}`);
}

export function updateBoardTitle(boardId, title) {
  return request(`/api/boards/${boardId}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

export function addBoardPage(boardId, name) {
  return request(`/api/boards/${boardId}/pages`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export function deleteBoard(boardId) {
  return request(`/api/boards/${boardId}`, {
    method: "DELETE"
  });
}

export function getApiBaseUrl() {
  return API_BASE_URL || "same-origin /api proxy";
}

import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import Dashboard from "./pages/Dashboard.jsx";
import BoardEditor from "./pages/BoardEditor.jsx";
import Toast from "./components/Toast.jsx";
import { useToast } from "./hooks/useToast.js";
import "./App.css";

/**
 * Root component. Owns the global toast surface and the route table.
 * The actual application surface lives in the page components.
 */
export default function App() {
  const toast = useToast();
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/board/:boardId"
          element={<BoardRoute showToast={toast.show} />}
        />
        <Route path="*" element={<Dashboard />} />
      </Routes>
      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </>
  );
}

/**
 * Pulls boardId from the URL and forwards it to the editor. Lives in
 * its own component so we can use the router hooks without forcing
 * the whole App tree to re-render.
 */
function BoardRoute({ showToast }) {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // If the URL has no boardId, bounce to the dashboard.
  useEffect(() => {
    if (!boardId) {
      navigate("/", { replace: true });
    }
  }, [boardId, navigate]);

  if (!boardId) return null;
  return (
    <BoardEditor
      key={`${boardId}:${location.search}`}
      boardId={boardId}
      showToast={showToast}
    />
  );
}


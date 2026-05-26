import { Routes, Route, Navigate } from 'react-router-dom';
import SceneListPage from './pages/SceneListPage';
import ViewerPage from './pages/ViewerPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/splats" replace />} />
      <Route path="/splats" element={<SceneListPage />} />
      <Route path="/splats/:slug" element={<ViewerPage />} />
    </Routes>
  );
}
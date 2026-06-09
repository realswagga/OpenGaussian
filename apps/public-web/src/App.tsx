import { Routes, Route, Navigate } from 'react-router-dom';
import SceneListPage from './pages/SceneListPage';
import ViewerPage from './pages/ViewerPage';
import CatalogPage from './pages/CatalogPage';
import OrganizationPage from './pages/OrganizationPage';
import AuthPage from './pages/AuthPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CatalogPage />} />
      <Route path="/search" element={<CatalogPage />} />
      <Route path="/splats" element={<SceneListPage />} />
      <Route path="/splats/:slug" element={<ViewerPage />} />
      <Route path="/orgs/:slug" element={<OrganizationPage />} />
      <Route path="/login" element={<AuthPage initialMode="login" />} />
      <Route path="/signup" element={<AuthPage initialMode="signup" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

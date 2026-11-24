import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@context/AuthContext';
import { ErrorBoundary } from '@components/ErrorBoundary';
import { ProtectedRoute } from '@components/ProtectedRoute';
import { ToastProvider } from '@components/ui/Toast';
import { PageLoader } from '@components/PageLoader';

const LandingPage = lazy(() => import('@pages/LandingPage'));
const RegisterPage = lazy(() => import('@pages/RegisterPage'));
const LoginPage = lazy(() => import('@pages/LoginPage'));
const DashboardPage = lazy(() => import('@pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const FilesPage = lazy(() => import('@pages/FilesPage').then((m) => ({ default: m.FilesPage })));
const SharedWithMePage = lazy(() => import('@pages/SharedWithMePage').then((m) => ({ default: m.SharedWithMePage })));
const SharedFolderPage = lazy(() => import('@pages/SharedFolderPage').then((m) => ({ default: m.SharedFolderPage })));
const ActivityPage = lazy(() => import('@pages/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const AskPage = lazy(() => import('@pages/AskPage').then((m) => ({ default: m.AskPage })));
const TrashPage = lazy(() => import('@pages/TrashPage').then((m) => ({ default: m.TrashPage })));
const AccountPage = lazy(() => import('@pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const PublicSharePage = lazy(() => import('@pages/PublicSharePage').then((m) => ({ default: m.PublicSharePage })));
const NotFoundPage = lazy(() => import('@pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

const protect = (page: React.ReactNode) => <ProtectedRoute>{page}</ProtectedRoute>;

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/share/:token" element={<PublicSharePage />} />
                <Route path="/dashboard" element={protect(<DashboardPage />)} />
                <Route path="/files" element={protect(<FilesPage />)} />
                <Route path="/files/:folderId" element={protect(<FilesPage />)} />
                <Route path="/shared-with-me" element={protect(<SharedWithMePage />)} />
                <Route path="/shared-with-me/folders/:folderId" element={protect(<SharedFolderPage />)} />
                <Route path="/ask" element={protect(<AskPage />)} />
                <Route path="/activity" element={protect(<ActivityPage />)} />
                <Route path="/trash" element={protect(<TrashPage />)} />
                <Route path="/account" element={protect(<AccountPage />)} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;

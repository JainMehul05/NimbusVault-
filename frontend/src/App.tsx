import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@context/AuthContext';
import { ProtectedRoute } from '@components/ProtectedRoute';
import { ToastProvider } from '@components/ui/Toast';
import LandingPage from '@pages/LandingPage';
import RegisterPage from '@pages/RegisterPage';
import LoginPage from '@pages/LoginPage';
import { DashboardPage } from '@pages/DashboardPage';
import { FilesPage } from '@pages/FilesPage';
import { SharedWithMePage } from '@pages/SharedWithMePage';
import { ActivityPage } from '@pages/ActivityPage';
import { PublicSharePage } from '@pages/PublicSharePage';
import { NotFoundPage } from '@pages/NotFoundPage';
import { AskPage } from '@pages/AskPage';
import { SharedFolderPage } from '@pages/SharedFolderPage';

const protect = (page: React.ReactNode) => <ProtectedRoute>{page}</ProtectedRoute>;

const App: React.FC = () => {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
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
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
};

export default App;

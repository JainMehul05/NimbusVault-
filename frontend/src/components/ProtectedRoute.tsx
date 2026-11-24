import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { Logo } from './ui/primitives';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background" role="status" aria-label="Loading your workspace">
        <Logo />
        <div className="h-0.5 w-24 overflow-hidden bg-white/10"><div className="skeleton h-full w-full bg-primary" /></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Remember where the user was going so sign-in can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
};

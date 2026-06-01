import React, { useState, useContext, Suspense, lazy } from 'react';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import PendingApprovalPage from './pages/PendingApprovalPage';
import { AuthContext } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import LoadingSpinner from './components/LoadingSpinner';
import AppStylesGate from './components/AppStylesGate';
const AuthenticatedAppShell = lazy(() => import('./components/AuthenticatedAppShell'));

const App: React.FC = () => {
  const auth = useContext(AuthContext);

  if (!auth) {
    return null; // Or a loading spinner
  }

  const { isAuthenticated, isApproved, isSignupRejected, approvalHardBlock, approvalSyncIssue } = auth;
  
  const [authHash, setAuthHash] = useState(() =>
    typeof window !== 'undefined' ? window.location.hash : ''
  );
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => setAuthHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!isAuthenticated) {
    const showSignup = authHash === '#signup';
    return (
      <ThemeProvider>
        {showSignup ? <SignupPage /> : <LoginPage />}
      </ThemeProvider>
    );
  }

  if (isApproved === null && !isSignupRejected && !approvalSyncIssue) {
    return (
      <ThemeProvider>
        <div className="flex justify-center items-center min-h-screen bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" aria-label="Checking access" />
        </div>
      </ThemeProvider>
    );
  }

  if (isSignupRejected || approvalSyncIssue || approvalHardBlock) {
    return (
      <ThemeProvider>
        <PendingApprovalPage />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AppStylesGate>
        <Suspense fallback={<LoadingSpinner className="min-h-screen" />}>
          <AuthenticatedAppShell />
        </Suspense>
      </AppStylesGate>
    </ThemeProvider>
  );
};

export default App;

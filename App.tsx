import React, { useState, useContext, Suspense, lazy } from 'react';
import { AuthContext } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import LoadingSpinner from './components/LoadingSpinner';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const PendingApprovalPage = lazy(() => import('./pages/PendingApprovalPage'));
const AuthenticatedAppShell = lazy(() => import('./components/AuthenticatedAppShell'));
const AppStylesGate = lazy(() => import('./components/AppStylesGate'));

const AuthShellFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50" aria-busy="true" aria-label="Loading">
    <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

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
        <Suspense fallback={<AuthShellFallback />}>
          {showSignup ? <SignupPage /> : <LoginPage />}
        </Suspense>
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
        <Suspense fallback={<AuthShellFallback />}>
          <PendingApprovalPage />
        </Suspense>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <Suspense fallback={<LoadingSpinner className="min-h-screen" />}>
        <AppStylesGate>
          <Suspense fallback={<LoadingSpinner className="min-h-screen" />}>
            <AuthenticatedAppShell />
          </Suspense>
        </AppStylesGate>
      </Suspense>
    </ThemeProvider>
  );
};

export default App;

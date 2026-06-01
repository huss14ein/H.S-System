import React, { useEffect, useState } from 'react';
import LoadingSpinner from './LoadingSpinner';
import { loadAppStyles } from '../utils/loadAppStyles';

/** Ensures full app CSS is loaded before rendering children (avoids FOUC after login). */
const AppStylesGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadAppStyles().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <LoadingSpinner className="min-h-screen" />;
  }

  return <>{children}</>;
};

export default AppStylesGate;

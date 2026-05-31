import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { installChunkLoadRecovery } from './utils/chunkLoadRecovery';
import { enforceCanonicalHostRedirect } from './utils/canonicalHostRedirect';
import { clearStalePwaCaches } from './utils/pwaCacheBust';

void clearStalePwaCaches();
enforceCanonicalHostRedirect();
installChunkLoadRecovery();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);

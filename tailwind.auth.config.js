/** Tailwind config for the unauthenticated shell (login / signup / pending). */
import base from './tailwind.config.js';

export default {
  ...base,
  theme: {
    ...base.theme,
    extend: {
      ...base.theme.extend,
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Inter',
          'sans-serif',
        ],
      },
    },
  },
  content: [
    './App.tsx',
    './pages/LoginPage.tsx',
    './pages/SignupPage.tsx',
    './pages/PendingApprovalPage.tsx',
    './components/LoadingSpinner.tsx',
    './components/icons/HSLogo.tsx',
  ],
};

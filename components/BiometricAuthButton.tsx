import React from 'react';
import { useBiometric } from '../context/BiometricContext';

interface BiometricAuthButtonProps {
  onAuthenticationSuccess?: () => void;
  onAuthenticationFailure?: () => void;
  className?: string;
  children?: React.ReactNode;
}

const BiometricAuthButton: React.FC<BiometricAuthButtonProps> = ({
  onAuthenticationSuccess,
  onAuthenticationFailure,
  className = '',
  children
}) => {
  const { 
    isSupported, 
    isAvailable, 
    isEnabled, 
    biometricType, 
    enableBiometric, 
    authenticate 
  } = useBiometric();

  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleBiometricAuth = async () => {
    if (!isSupported || !isAvailable) {
      setError('Biometric authentication is not available on this device');
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      let success = false;

      if (!isEnabled) {
        // Enable biometric first
        success = await enableBiometric();
        if (success) {
          // Then authenticate
          success = await authenticate('Set up biometric authentication');
        }
      } else {
        // Just authenticate
        success = await authenticate('Authenticate to continue');
      }

      if (success) {
        onAuthenticationSuccess?.();
      } else {
        setError('Authentication failed. Please try again.');
        onAuthenticationFailure?.();
      }
    } catch (err) {
      setError('An error occurred during authentication');
      onAuthenticationFailure?.();
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (!isSupported) {
    return null;
  }

  const getBiometricIcon = () => {
    switch (biometricType) {
      case 'fingerprint':
        return React.createElement(
          'svg',
          { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
          React.createElement('path', { 
            strokeLinecap: 'round', 
            strokeLinejoin: 'round', 
            strokeWidth: 2, 
            d: 'M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4' 
          })
        );
      case 'face':
        return React.createElement(
          'svg',
          { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
          React.createElement('path', { 
            strokeLinecap: 'round', 
            strokeLinejoin: 'round', 
            strokeWidth: 2, 
            d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' 
          }),
          React.createElement('path', { 
            strokeLinecap: 'round', 
            strokeLinejoin: 'round', 
            strokeWidth: 2, 
            d: 'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' 
          })
        );
      default:
        return React.createElement(
          'svg',
          { className: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
          React.createElement('path', { 
            strokeLinecap: 'round', 
            strokeLinejoin: 'round', 
            strokeWidth: 2, 
            d: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' 
          })
        );
    }
  };

  const getButtonText = () => {
    if (isAuthenticating) {
      return 'Authenticating...';
    }
    
    if (!isEnabled) {
      return 'Enable Biometric';
    }
    
    if (biometricType === 'fingerprint') {
      return 'Use Fingerprint';
    } else if (biometricType === 'face') {
      return 'Use Face ID';
    }
    
    return 'Use Biometric';
  };

  return React.createElement(
    'div',
    { className: `relative ${className}` },
    [
      children || React.createElement(
        'button',
        {
          key: 'biometric-button',
          onClick: handleBiometricAuth,
          disabled: isAuthenticating || !isAvailable,
          className: `flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`,
          title: isAvailable ? 'Authenticate using biometrics' : 'Biometric authentication not available'
        },
        [
          getBiometricIcon(),
          React.createElement(
            'span',
            { key: 'text', className: 'text-sm font-medium' },
            getButtonText()
          ),
          isAuthenticating && React.createElement(
            'div',
            { key: 'spinner', className: 'w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin' }
          )
        ]
      ),
      
      error && React.createElement(
        'div',
        {
          key: 'error',
          className: 'absolute top-full mt-2 left-0 right-0 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm p-2 rounded-lg border border-red-200 dark:border-red-800'
        },
        error
      ),
      
      !isAvailable && isSupported && React.createElement(
        'div',
        {
          key: 'unavailable',
          className: 'absolute top-full mt-2 left-0 right-0 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 text-sm p-2 rounded-lg border border-yellow-200 dark:border-yellow-800'
        },
        'Biometric authentication is not available on this device'
      )
    ]
  );
};

export default BiometricAuthButton;

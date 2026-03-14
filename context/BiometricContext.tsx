import React, { createContext, useState, useEffect, ReactNode } from 'react';

export interface BiometricContextType {
  isSupported: boolean;
  isAvailable: boolean;
  isEnabled: boolean;
  biometricType: 'fingerprint' | 'face' | 'voice' | 'none';
  checkAvailability: () => Promise<boolean>;
  enableBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<boolean>;
  authenticate: (prompt?: string) => Promise<boolean>;
  biometricCredentials: BiometricCredential[];
  saveCredential: (name: string, credential: Credential) => Promise<boolean>;
  removeCredential: (id: string) => Promise<boolean>;
}

export interface BiometricCredential {
  id: string;
  name: string;
  type: 'public-key';
  created: Date;
  lastUsed?: Date;
}

const BiometricContext = createContext<BiometricContextType | null>(null);

export const useBiometric = () => {
  const context = React.useContext(BiometricContext);
  if (!context) {
    throw new Error('useBiometric must be used within a BiometricProvider');
  }
  return context;
};

interface BiometricProviderProps {
  children: ReactNode;
}

export const BiometricProvider: React.FC<BiometricProviderProps> = ({ children }) => {
  const [isSupported, setIsSupported] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face' | 'voice' | 'none'>('none');
  const [biometricCredentials, setBiometricCredentials] = useState<BiometricCredential[]>([]);

  // Check biometric support on mount
  useEffect(() => {
    checkBiometricSupport();
    loadBiometricSettings();
    loadCredentials();
  }, []);

  const checkBiometricSupport = async () => {
    const supported = 'credentials' in navigator && 'PublicKeyCredential' in window;
    setIsSupported(supported);
    
    if (supported) {
      await checkAvailability();
    }
  };

  const checkAvailability = async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    try {
      // Check if biometric authentication is available
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      setIsAvailable(available);
      
      if (available) {
        // Try to determine the type of biometric available
        const result = await navigator.credentials.get({
          publicKey: {
            challenge: new Uint8Array(32),
            allowCredentials: [],
            userVerification: 'required',
            extensions: {
              credProps: true
            }
          }
        }) as PublicKeyCredential;

        if (result && result.getClientExtensionResults().credProps) {
          const props = result.getClientExtensionResults().credProps as any;
          if (props.userVerified) {
            // Determine biometric type based on available authenticators
            setBiometricType('fingerprint'); // Default to fingerprint
          }
        }
      }
      
      return available;
    } catch (error) {
      console.error('Biometric availability check failed:', error);
      setIsAvailable(false);
      return false;
    }
  };

  const loadBiometricSettings = () => {
    try {
      const enabled = localStorage.getItem('biometricEnabled') === 'true';
      const type = localStorage.getItem('biometricType') as 'fingerprint' | 'face' | 'voice' | 'none';
      
      setIsEnabled(enabled);
      if (type) {
        setBiometricType(type);
      }
    } catch (error) {
      console.error('Failed to load biometric settings:', error);
    }
  };

  const loadCredentials = () => {
    try {
      const stored = localStorage.getItem('biometricCredentials');
      if (stored) {
        const creds = JSON.parse(stored).map((cred: any) => ({
          ...cred,
          created: new Date(cred.created),
          lastUsed: cred.lastUsed ? new Date(cred.lastUsed) : undefined
        }));
        setBiometricCredentials(creds);
      }
    } catch (error) {
      console.error('Failed to load biometric credentials:', error);
    }
  };

  const saveBiometricSettings = (enabled: boolean, type: 'fingerprint' | 'face' | 'voice' | 'none') => {
    try {
      localStorage.setItem('biometricEnabled', enabled.toString());
      localStorage.setItem('biometricType', type);
    } catch (error) {
      console.error('Failed to save biometric settings:', error);
    }
  };

  const saveCredentials = (credentials: BiometricCredential[]) => {
    try {
      localStorage.setItem('biometricCredentials', JSON.stringify(credentials));
    } catch (error) {
      console.error('Failed to save biometric credentials:', error);
    }
  };

  const enableBiometric = async (): Promise<boolean> => {
    if (!isAvailable) {
      return false;
    }

    try {
      // Create a new biometric credential
      const userId = new TextEncoder().encode('user-' + Date.now());
      const challenge = new Uint8Array(32);
      
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'H.S Financial System',
            id: window.location.hostname
          },
          user: {
            id: userId,
            name: 'User',
            displayName: 'H.S Finance User'
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' }, // ES256
            { alg: -257, type: 'public-key' } // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          timeout: 60000,
          attestation: 'direct'
        }
      }) as PublicKeyCredential;

      if (credential) {
        const newCredential: BiometricCredential = {
          id: credential.id,
          name: 'Primary Device',
          type: 'public-key',
          created: new Date()
        };

        setBiometricCredentials(prev => [...prev, newCredential]);
        saveCredentials([...biometricCredentials, newCredential]);
        
        setIsEnabled(true);
        saveBiometricSettings(true, biometricType);
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Failed to enable biometric authentication:', error);
      return false;
    }
  };

  const disableBiometric = async (): Promise<boolean> => {
    try {
      // Remove all biometric credentials
      for (const credential of biometricCredentials) {
        await removeCredential(credential.id);
      }
      
      setIsEnabled(false);
      saveBiometricSettings(false, 'none');
      
      return true;
    } catch (error) {
      console.error('Failed to disable biometric authentication:', error);
      return false;
    }
  };

  const authenticate = async (prompt: string = 'Authenticate to continue'): Promise<boolean> => {
    if (!isEnabled || !isAvailable || biometricCredentials.length === 0) {
      return false;
    }

    try {
      // Try authentication with existing credentials
      const challenge = new Uint8Array(32);
      const allowCredentials = biometricCredentials.map(cred => ({
        id: new TextEncoder().encode(cred.id),
        type: 'public-key' as const,
        transports: ['internal', 'usb', 'nfc', 'ble'] as AuthenticatorTransport[]
      }));

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials,
          userVerification: 'required',
          timeout: 60000
        }
      }) as PublicKeyCredential;

      if (credential) {
        // Update last used time
        const updatedCredentials = biometricCredentials.map(cred =>
          cred.id === credential.id ? { ...cred, lastUsed: new Date() } : cred
        );
        setBiometricCredentials(updatedCredentials);
        saveCredentials(updatedCredentials);
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Biometric authentication failed:', error);
      return false;
    }
  };

  const saveCredential = async (name: string, credential: Credential): Promise<boolean> => {
    try {
      const newCredential: BiometricCredential = {
        id: credential.id,
        name,
        type: 'public-key',
        created: new Date()
      };

      setBiometricCredentials(prev => [...prev, newCredential]);
      saveCredentials([...biometricCredentials, newCredential]);
      
      return true;
    } catch (error) {
      console.error('Failed to save biometric credential:', error);
      return false;
    }
  };

  const removeCredential = async (id: string): Promise<boolean> => {
    try {
      setBiometricCredentials(prev => prev.filter(cred => cred.id !== id));
      saveCredentials(biometricCredentials.filter(cred => cred.id !== id));
      
      return true;
    } catch (error) {
      console.error('Failed to remove biometric credential:', error);
      return false;
    }
  };

  const value: BiometricContextType = {
    isSupported,
    isAvailable,
    isEnabled,
    biometricType,
    checkAvailability,
    enableBiometric,
    disableBiometric,
    authenticate,
    biometricCredentials,
    saveCredential,
    removeCredential
  };

  return React.createElement(
    BiometricContext.Provider,
    { value },
    children
  );
};

export default BiometricContext;

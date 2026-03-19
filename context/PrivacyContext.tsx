import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'finova_mask_sensitive_v1';
const NOTIFICATION_SOUND_KEY = 'finova_notification_sound_v1';

type PrivacyValue = {
  maskSensitive: boolean;
  setMaskSensitive: (v: boolean) => void;
  /** Mask a pre-formatted currency string for screen privacy. */
  maskBalance: (formatted: string) => string;
  /** Short beep when notification count increases / bell (off by default). */
  playNotificationSound: boolean;
  setPlayNotificationSound: (v: boolean) => void;
};

const PrivacyContext = createContext<PrivacyValue | null>(null);

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [maskSensitive, setMaskSensitiveState] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [playNotificationSound, setPlayNotificationSoundState] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(NOTIFICATION_SOUND_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, maskSensitive ? '1' : '0');
    } catch {}
  }, [maskSensitive]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATION_SOUND_KEY, playNotificationSound ? '1' : '0');
    } catch {}
  }, [playNotificationSound]);

  const setMaskSensitive = useCallback((v: boolean) => setMaskSensitiveState(v), []);
  const setPlayNotificationSound = useCallback((v: boolean) => setPlayNotificationSoundState(v), []);
  const maskBalance = useCallback((formatted: string) => (maskSensitive ? '••••' : formatted), [maskSensitive]);

  const value = useMemo(
    () => ({
      maskSensitive,
      setMaskSensitive,
      maskBalance,
      playNotificationSound,
      setPlayNotificationSound,
    }),
    [maskSensitive, setMaskSensitive, maskBalance, playNotificationSound, setPlayNotificationSound]
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacyMask(): PrivacyValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    return {
      maskSensitive: false,
      setMaskSensitive: () => {},
      maskBalance: (s) => s,
      playNotificationSound: false,
      setPlayNotificationSound: () => {},
    };
  }
  return ctx;
}

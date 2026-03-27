import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import { User, Session, AuthError } from '@supabase/supabase-js';

// Security configuration
const SECURITY_CONFIG = {
  MIN_PASSWORD_LENGTH: 12,
  MAX_PASSWORD_LENGTH: 128,
  MAX_SIGNUP_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  PASSWORD_REQUIREMENTS: {
    uppercase: /[A-Z]/,
    lowercase: /[a-z]/,
    number: /[0-9]/,
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/
  }
};

interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  strength: 'weak' | 'fair' | 'good' | 'strong';
  entropy?: number;
  entropyScore?: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
}

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  lastAttempt: number;
}

// Persistent rate limiting storage (sessionStorage-based)
const persistentRateLimitStore = {
  get: (key: string): RateLimitEntry | null => {
    try {
      const stored = sessionStorage.getItem(`rate_limit_${key}`);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },
  set: (key: string, value: RateLimitEntry): void => {
    try {
      sessionStorage.setItem(`rate_limit_${key}`, JSON.stringify(value));
    } catch {
      // Silently fail if sessionStorage is not available
    }
  },
  delete: (key: string): void => {
    try {
      sessionStorage.removeItem(`rate_limit_${key}`);
    } catch {
      // Silently fail if sessionStorage is not available
    }
  },
  clear: (): void => {
    try {
      const keys = Object.keys(sessionStorage);
      keys.forEach(key => {
        if (key.startsWith('rate_limit_')) {
          sessionStorage.removeItem(key);
        }
      });
    } catch {
      // Silently fail if sessionStorage is not available
    }
  }
};

// Device fingerprinting for anomaly detection
function getDeviceFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'canvas_unsupported';
    
    // Draw text for canvas fingerprint
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Device fingerprint', 2, 2);
    
    // Get canvas data
    const canvasFingerprint = canvas.toDataURL().slice(-50);
    
    // Collect browser info
    const browserInfo = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      screen: `${screen.width}x${screen.height}`,
      colorDepth: screen.colorDepth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      canvas: canvasFingerprint
    };
    
    // Create hash
    const fingerprintString = Object.values(browserInfo).join('|');
    return btoa(fingerprintString).slice(0, 32);
  } catch (error) {
    return 'fingerprint_error';
  }
}

// Check for device anomalies
function checkDeviceAnomaly(fingerprint: string, userId: string): { isAnomaly: boolean; risk: 'low' | 'medium' | 'high'; message?: string } {
  const stored = sessionStorage.getItem(`device_${userId}`);
  
  if (!stored) {
    // First time device - store fingerprint
    sessionStorage.setItem(`device_${userId}`, JSON.stringify({
      fingerprint,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      count: 1
    }));
    return { isAnomaly: false, risk: 'low' };
  }
  
  const deviceData = JSON.parse(stored);
  
  // Check if fingerprint matches
  if (deviceData.fingerprint !== fingerprint) {
    // In production, this would log to a security monitoring system
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn('Device anomaly detected', {
        userId,
        oldFingerprint: deviceData.fingerprint,
        newFingerprint: fingerprint,
        lastSeen: deviceData.lastSeen
      });
    }
    
    // Update with new device
    sessionStorage.setItem(`device_${userId}`, JSON.stringify({
      fingerprint,
      firstSeen: deviceData.firstSeen,
      lastSeen: Date.now(),
      count: deviceData.count + 1
    }));
    
    return { 
      isAnomaly: true, 
      risk: 'high',
      message: 'New device detected. Please verify your identity.'
    };
  }
  
  // Update last seen
  deviceData.lastSeen = Date.now();
  deviceData.count++;
  sessionStorage.setItem(`device_${userId}`, JSON.stringify(deviceData));
  
  return { isAnomaly: false, risk: 'low' };
}

// Password entropy calculation function
function calculatePasswordEntropy(password: string): number {
  if (!password) return 0;
  
  // Count unique characters
  const uniqueChars = new Set(password).size;
  const length = password.length;
  
  // Calculate character set size
  let charsetSize = 0;
  if (/[a-z]/.test(password)) charsetSize += 26; // lowercase
  if (/[A-Z]/.test(password)) charsetSize += 26; // uppercase
  if (/[0-9]/.test(password)) charsetSize += 10; // numbers
  if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32; // special chars (approximate)
  
  // Entropy formula: log2(charset_size^length) = length * log2(charset_size)
  // Adjusted for character variety
  const varietyFactor = uniqueChars / length;
  const entropy = length * Math.log2(charsetSize) * varietyFactor;
  
  return Math.round(entropy * 100) / 100; // Round to 2 decimal places
}

// Get entropy score category
function getEntropyScore(entropy: number): 'very_low' | 'low' | 'medium' | 'high' | 'very_high' {
  if (entropy < 28) return 'very_low';      // < 28 bits - very weak
  if (entropy < 36) return 'low';           // 28-35 bits - weak
  if (entropy < 60) return 'medium';       // 36-59 bits - moderate
  if (entropy < 80) return 'high';         // 60-79 bits - strong
  return 'very_high';                       // >= 80 bits - very strong
}

// Password validation function with enhanced error messages
function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  
  if (password.length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${SECURITY_CONFIG.MIN_PASSWORD_LENGTH} characters long (currently ${password.length})`);
  }
  
  if (password.length > SECURITY_CONFIG.MAX_PASSWORD_LENGTH) {
    errors.push(`Password must not exceed ${SECURITY_CONFIG.MAX_PASSWORD_LENGTH} characters`);
  }
  
  if (!SECURITY_CONFIG.PASSWORD_REQUIREMENTS.uppercase.test(password)) {
    errors.push('Password must contain at least one uppercase letter (A-Z)');
  }
  
  if (!SECURITY_CONFIG.PASSWORD_REQUIREMENTS.lowercase.test(password)) {
    errors.push('Password must contain at least one lowercase letter (a-z)');
  }
  
  if (!SECURITY_CONFIG.PASSWORD_REQUIREMENTS.number.test(password)) {
    errors.push('Password must contain at least one number (0-9)');
  }
  
  if (!SECURITY_CONFIG.PASSWORD_REQUIREMENTS.special.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&* etc.)');
  }
  
  // Check for common patterns
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password contains repeated characters (e.g., "aaa" or "111")');
  }
  
  if (/^(password|123456|qwerty|admin|letmein)/i.test(password)) {
    errors.push('Password contains common weak patterns. Avoid using "password", "123456", "qwerty", etc.');
  }
  
  // Check for sequential patterns
  if (/123|abc|qwe/i.test(password)) {
    errors.push('Password contains sequential patterns. Avoid using "123", "abc", "qwe", etc.');
  }
  
  // Calculate strength and entropy
  let strengthScore = 0;
  if (password.length >= 12) strengthScore++;
  if (password.length >= 16) strengthScore++;
  if (SECURITY_CONFIG.PASSWORD_REQUIREMENTS.uppercase.test(password)) strengthScore++;
  if (SECURITY_CONFIG.PASSWORD_REQUIREMENTS.lowercase.test(password)) strengthScore++;
  if (SECURITY_CONFIG.PASSWORD_REQUIREMENTS.number.test(password)) strengthScore++;
  if (SECURITY_CONFIG.PASSWORD_REQUIREMENTS.special.test(password)) strengthScore++;
  
  let strength: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
  if (strengthScore >= 5) strength = 'strong';
  else if (strengthScore >= 4) strength = 'good';
  else if (strengthScore >= 3) strength = 'fair';
  
  // Calculate entropy
  const entropy = calculatePasswordEntropy(password);
  const entropyScore = getEntropyScore(entropy);
  
  return { isValid: errors.length === 0, errors, strength, entropy, entropyScore };
}

// Email validation with strict rules and enhanced error messages
function validateEmail(email: string): { isValid: boolean; error?: string } {
  // Sanitize input first
  const sanitized = email.trim().toLowerCase();
  
  // Check length
  if (sanitized.length > 254) {
    return { isValid: false, error: 'Email address is too long (max 254 characters)' };
  }
  
  if (sanitized.length < 5) {
    return { isValid: false, error: 'Email address is too short (min 5 characters)' };
  }
  
  // Check for @ symbol
  if (!sanitized.includes('@')) {
    return { isValid: false, error: 'Email must contain @ symbol' };
  }
  
  const parts = sanitized.split('@');
  if (parts.length !== 2) {
    return { isValid: false, error: 'Email must contain exactly one @ symbol' };
  }
  
  const [localPart, domain] = parts;
  
  // Validate local part
  if (localPart.length === 0) {
    return { isValid: false, error: 'Email cannot start with @' };
  }
  
  if (localPart.length > 64) {
    return { isValid: false, error: 'Email username is too long (max 64 characters)' };
  }
  
  // Validate domain
  if (domain.length === 0) {
    return { isValid: false, error: 'Email must have a domain after @' };
  }
  
  if (!domain.includes('.')) {
    return { isValid: false, error: 'Email domain must contain a . (e.g., gmail.com)' };
  }
  
  // RFC 5322 compliant regex (simplified but strict)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!emailRegex.test(sanitized)) {
    return { isValid: false, error: 'Email format is invalid. Please check for typos.' };
  }
  
  // Check for disposable email domains (common ones)
  const disposableDomains = ['tempmail.com', '10minutemail.com', 'guerrillamail.com', 'mailinator.com', 'throwaway.email'];
  
  if (disposableDomains.includes(domain)) {
    return { isValid: false, error: 'Please use a permanent email address instead of a temporary one' };
  }
  
  return { isValid: true };
}

// Name validation and sanitization with enhanced error messages
function validateAndSanitizeName(name: string): { isValid: boolean; sanitized: string; error?: string } {
  // Trim and basic sanitization
  let sanitized = name.trim().replace(/[<>\"']/g, '');
  
  if (sanitized.length === 0) {
    return { isValid: false, sanitized: '', error: 'Name cannot be empty' };
  }
  
  if (sanitized.length < 2) {
    return { isValid: false, sanitized: '', error: 'Name must be at least 2 characters long' };
  }
  
  if (sanitized.length > 100) {
    return { isValid: false, sanitized: '', error: 'Name is too long (max 100 characters)' };
  }
  
  // Check for valid characters (letters, spaces, hyphens, apostrophes)
  const validNameRegex = /^[a-zA-Z\s\-'\.]+$/;
  if (!validNameRegex.test(sanitized)) {
    return { isValid: false, sanitized: '', error: 'Name can only contain letters, spaces, hyphens (-), apostrophes (\'), and periods (.)' };
  }
  
  // Check for invalid patterns
  if (sanitized.startsWith('-') || sanitized.startsWith('.') || sanitized.startsWith('\'')) {
    return { isValid: false, sanitized: '', error: 'Name cannot start with special characters' };
  }
  
  if (sanitized.endsWith('-') || sanitized.endsWith('.') || sanitized.endsWith('\'')) {
    return { isValid: false, sanitized: '', error: 'Name cannot end with special characters' };
  }
  
  // Check for multiple consecutive spaces
  if (/\s{2,}/.test(sanitized)) {
    return { isValid: false, sanitized: '', error: 'Name cannot contain multiple consecutive spaces' };
  }
  
  // Check for multiple consecutive special characters
  if (/[-'\.]{2,}/.test(sanitized)) {
    return { isValid: false, sanitized: '', error: 'Name cannot contain multiple consecutive special characters' };
  }
  
  return { isValid: true, sanitized };
}

// Rate limiting check with persistent storage
function checkRateLimit(identifier: string): { allowed: boolean; waitTime?: number; message?: string } {
  const now = Date.now();
  const entry = persistentRateLimitStore.get(identifier);
  
  if (!entry) {
    // First attempt
    persistentRateLimitStore.set(identifier, {
      attempts: 1,
      firstAttempt: now,
      lastAttempt: now
    });
    return { allowed: true };
  }
  
  // Check if window has expired
  if (now - entry.firstAttempt > SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS) {
    // Reset window
    persistentRateLimitStore.set(identifier, {
      attempts: 1,
      firstAttempt: now,
      lastAttempt: now
    });
    return { allowed: true };
  }
  
  // Check if max attempts exceeded
  if (entry.attempts >= SECURITY_CONFIG.MAX_SIGNUP_ATTEMPTS) {
    const waitTime = SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS - (now - entry.firstAttempt);
    const waitMinutes = Math.ceil(waitTime / 60000);
    return {
      allowed: false,
      waitTime,
      message: `Too many signup attempts. Please try again in ${waitMinutes} minutes.`
    };
  }
  
  // Increment attempt
  entry.attempts++;
  entry.lastAttempt = now;
  persistentRateLimitStore.set(identifier, entry);
  
  return { allowed: true };
}

// Advanced security logging system
interface SecurityLogEntry {
  correlationId: string;
  timestamp: string;
  event: string;
  success: boolean;
  riskScore: number;
  userId?: string;
  sessionId?: string;
  metadata: {
    userAgent: string;
    platform: string;
    ipHash?: string;
    deviceFingerprint?: string;
    [key: string]: unknown;
  };
}

class SecurityLogger {
  private static instance: SecurityLogger;
  private logs: SecurityLogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs in memory

  static getInstance(): SecurityLogger {
    if (!SecurityLogger.instance) {
      SecurityLogger.instance = new SecurityLogger();
    }
    return SecurityLogger.instance;
  }

  // Generate correlation ID for tracking related events
  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Calculate risk score based on event and context
  private calculateRiskScore(event: string, success: boolean, details: Record<string, unknown>): number {
    let score = 0;
    
    // Base risk by event type
    const eventRiskScores: Record<string, number> = {
      'login_failed': 30,
      'login_success': 5,
      'signup_failed': 25,
      'signup_success': 10,
      '2fa_failed': 40,
      '2fa_success': 5,
      'device_anomaly': 70,
      'suspicious_login': 80,
      'session_refresh_failed': 35,
      'rate_limit_exceeded': 60,
      'validation_failed': 20
    };
    
    score = eventRiskScores[event] || 10;
    
    // Increase risk for failed events
    if (!success) {
      score *= 1.5;
    }
    
    // Additional risk factors
    if (details.attempts && Number(details.attempts) > 3) {
      score += 20;
    }
    
    if (details.newDevice) {
      score += 15;
    }
    
    return Math.min(100, Math.round(score));
  }

  // Hash IP for privacy (in production, use proper hashing)
  private hashIP(ip: string): string {
    return btoa(ip).slice(0, 8);
  }

  // Main logging method
  log(event: string, details: Record<string, unknown>, success: boolean): void {
    const correlationId = this.generateCorrelationId();
    const timestamp = new Date().toISOString();
    
    const logEntry: SecurityLogEntry = {
      correlationId,
      timestamp,
      event,
      success,
      riskScore: this.calculateRiskScore(event, success, details),
      userId: details.userId as string | undefined,
      sessionId: details.sessionId as string | undefined,
      metadata: {
        userAgent: navigator.userAgent.slice(0, 100),
        platform: navigator.platform,
        ipHash: details.ip ? this.hashIP(details.ip as string) : undefined,
        deviceFingerprint: details.deviceFingerprint as string | undefined,
        ...details
      }
    };
    
    // Add to in-memory logs
    this.logs.push(logEntry);
    
    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    // Console log for development
    if (process.env.NODE_ENV === 'development') {
      console.warn('Security Event:', logEntry);
    }
    
    // In production, send to secure logging service
    this.sendToLogService(logEntry);
  }

  // Send to external logging service (in production)
  private async sendToLogService(logEntry: SecurityLogEntry): Promise<void> {
    // In production, implement secure logging to external service
    // For now, just store in sessionStorage for debugging
    try {
      const existingLogs = JSON.parse(sessionStorage.getItem('security_logs') || '[]');
      existingLogs.push(logEntry);
      
      // Keep only last 100 logs in sessionStorage
      if (existingLogs.length > 100) {
        existingLogs.splice(0, existingLogs.length - 100);
      }
      
      sessionStorage.setItem('security_logs', JSON.stringify(existingLogs));
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn('Failed to store security logs:', error);
      }
    }
  }

  // Get recent logs for analysis
  getRecentLogs(count: number = 50): SecurityLogEntry[] {
    return this.logs.slice(-count);
  }

  // Get logs by correlation ID
  getLogsByCorrelationId(correlationId: string): SecurityLogEntry[] {
    return this.logs.filter(log => log.correlationId === correlationId);
  }

  // Get high-risk events
  getHighRiskEvents(threshold: number = 70): SecurityLogEntry[] {
    return this.logs.filter(log => log.riskScore >= threshold);
  }

  // Clear logs (for testing or admin use)
  clearLogs(): void {
    this.logs = [];
    try {
      sessionStorage.removeItem('security_logs');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn('Failed to clear security logs:', error);
      }
    }
  }
}

// Enhanced security logging function
function logSecurityEvent(event: string, details: Record<string, unknown>, success: boolean): void {
  const logger = SecurityLogger.getInstance();
  logger.log(event, details, success);
}

export interface SecurityValidationResult {
  isValid: boolean;
  passwordValidation?: PasswordValidationResult;
  emailValidation?: { isValid: boolean; error?: string };
  nameValidation?: { isValid: boolean; error?: string };
  rateLimit?: { allowed: boolean; waitTime?: number; message?: string };
}

interface AuthContextType {
  isAuthenticated: boolean;
  isApproved: boolean | null;
  user: User | null;
  session: Session | null;
  login: (email: string, password: string) => Promise<{ error: AuthError | null; user?: User | null }>;
  logout: () => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<{ error: AuthError | null; user?: User | null; validation?: SecurityValidationResult }>;
  resendVerificationEmail: (email: string) => Promise<{ error: AuthError | null }>;
  validateSignupInput: (name: string, email: string, password: string) => SecurityValidationResult;
  resetRateLimit: (identifier: string) => void;
  // 2FA methods
  send2FACode: (userId: string) => Promise<{ error: AuthError | null }>;
  verify2FACode: (code: string) => Promise<{ error: AuthError | null; success: boolean }>;
  is2FAEnabled: boolean;
  twoFactorMethod: 'email' | 'sms' | 'totp' | null;
  enable2FA: (method: 'email' | 'sms' | 'totp') => Promise<{ error: AuthError | null }>;
  disable2FA: () => Promise<{ error: AuthError | null }>;
  isEmailVerified: boolean;
  // Session management
  sessionExpiryTime: number | null;
  extendSession: () => Promise<{ error: AuthError | null }>;
  isSessionExpiring: boolean;
  timeUntilExpiry: number;
  refetchApprovalStatus: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [isApproved, setIsApproved] = useState<boolean | null>(null);
    const [isEmailVerified, setIsEmailVerified] = useState(false);
    const [is2FAEnabled, setIs2FAEnabled] = useState(false);
    const [twoFactorMethod, setTwoFactorMethod] = useState<'email' | 'sms' | 'totp' | null>(null);
    const [sessionExpiryTime, setSessionExpiryTime] = useState<number | null>(null);
    const [isSessionExpiring, setIsSessionExpiring] = useState(false);
    const [timeUntilExpiry, setTimeUntilExpiry] = useState(0);

    // Session management effect
    useEffect(() => {
        if (!session) {
            setSessionExpiryTime(null);
            setIsSessionExpiring(false);
            setTimeUntilExpiry(0);
            return;
        }

        // Prefer provider-issued expiry time; fallback to 24h if unavailable.
        const sessionExpiryMs = Number((session as any)?.expires_at) > 0
            ? Number((session as any).expires_at) * 1000
            : Date.now() + (24 * 60 * 60 * 1000);
        const expiryTime = sessionExpiryMs;
        setSessionExpiryTime(expiryTime);

        // Check session expiry every minute
        const interval = setInterval(() => {
            const now = Date.now();
            const timeLeft = expiryTime - now;
            setTimeUntilExpiry(timeLeft);

            // Show warning when less than 5 minutes left
            if (timeLeft < 5 * 60 * 1000 && timeLeft > 0) {
                setIsSessionExpiring(true);
            } else if (timeLeft <= 0) {
                // Do not force a local auto-logout loop on background/visibility changes.
                // Supabase auth state will naturally transition on invalid session.
                setIsSessionExpiring(true);
                setTimeUntilExpiry(0);
            } else {
                setIsSessionExpiring(false);
            }
        }, 60 * 1000); // Check every minute

        return () => clearInterval(interval);
    }, [session]);

    // Extend session function
    const extendSession = useCallback(async () => {
        if (!supabase || !session) return { error: { name: 'AuthApiError', message: 'No active session' } as AuthError };
        
        try {
            // Refresh the session
            const { data, error } = await supabase.auth.refreshSession();
            
            if (error) {
                logSecurityEvent('session_refresh_failed', { userId: user?.id, error: error.message }, false);
                return { error: { name: error.name, message: error.message } as AuthError };
            }

            if (data.session) {
                setSession(data.session);
                const newExpiryTime = Date.now() + (24 * 60 * 60 * 1000);
                setSessionExpiryTime(newExpiryTime);
                setIsSessionExpiring(false);
                
                logSecurityEvent('session_extended', { userId: user?.id }, true);
            }

            return { error: null };
        } catch (error) {
            logSecurityEvent('session_extend_error', { userId: user?.id, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: 'Failed to extend session' } as AuthError };
        }
    }, [supabase, session, user]);

    /** Never block auth init: if the query hangs or Netlify/RLS blocks REST, we time out and fail open (approved). */
    const fetchApprovalStatus = useCallback(async (userId: string) => {
        if (!supabase) {
            setIsApproved(true);
            return;
        }
        const APPROVAL_FETCH_MS = 8000;
        try {
            // Use select() without a column list so Postgres returns all existing columns.
            // If `approved` was never migrated, .select('approved') errors with 42703.
            const query = supabase
                .from('users')
                .select()
                .eq('id', userId)
                .maybeSingle();

            const timeout = new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), APPROVAL_FETCH_MS);
            });

            const result = await Promise.race([query, timeout]);
            if (result === null) {
                setIsApproved(true);
                return;
            }
            const { data, error } = result as { data: Record<string, unknown> | null; error: { message?: string } | null };
            if (error) {
                setIsApproved(true);
                return;
            }
            // No public.users row: do not grant access (signup trigger missing or race before insert completes).
            if (data == null) {
                setIsApproved(false);
                return;
            }
            // Legacy DB without `approved` column: field absent → treat as approved.
            const raw = data.approved;
            const hasApprovedKey = Object.prototype.hasOwnProperty.call(data, 'approved');
            setIsApproved(!hasApprovedKey ? true : Boolean(raw));
        } catch {
            setIsApproved(true);
        }
    }, []);

    useEffect(() => {
        const currentSupabase = supabase;
        if (!currentSupabase) {
            if (process.env.NODE_ENV === 'development') {
              // eslint-disable-next-line no-console
              console.warn("Supabase client is not available because environment variables are missing. Authentication is disabled.");
            }
            setLoading(false);
            setIsApproved(true);
            return;
        }
    
        const getSession = async () => {
            try {
                const { data: { session } } = await currentSupabase.auth.getSession();
                setSession(session);
                setUser(session?.user ?? null);
                setIsEmailVerified(session?.user?.email_confirmed_at ? true : false);
                if (session?.user?.id) {
                    void fetchApprovalStatus(session.user.id);
                } else {
                    setIsApproved(null);
                }
            } catch {
                setSession(null);
                setUser(null);
                setIsApproved(null);
            } finally {
                setLoading(false);
            }
        };
    
        void getSession();
    
        const { data: { subscription } } = currentSupabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            setIsEmailVerified(session?.user?.email_confirmed_at ? true : false);
            if (session?.user?.id) {
                void fetchApprovalStatus(session.user.id);
            } else {
                setIsApproved(null);
            }
            setLoading(false);
        });
    
        return () => subscription.unsubscribe();
    }, [fetchApprovalStatus]);

    const login = async (email: string, pass: string) => {
        if (!supabase) return { error: { name: 'AuthApiError', message: 'Supabase not configured' } as AuthError };
        
        try {
            // Get device fingerprint for anomaly detection
            const deviceFingerprint = getDeviceFingerprint();
            
            // Check rate limiting
            const rateCheck = checkRateLimit(email);
            if (!rateCheck.allowed) {
                return { error: { name: 'AuthApiError', message: rateCheck.message } as AuthError };
            }

            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password: pass
            });

            if (error) {
                logSecurityEvent('login_failed', { email, reason: error.message }, false);
                return { error: { name: error.name, message: error.message } as AuthError };
            }

            if (data.user) {
                // Check for device anomaly
                const deviceCheck = checkDeviceAnomaly(deviceFingerprint, data.user.id);
                if (deviceCheck.isAnomaly && deviceCheck.risk === 'high') {
                    logSecurityEvent('suspicious_login', { 
                        userId: data.user.id, 
                        email, 
                        deviceFingerprint,
                        reason: 'new_device'
                    }, false);
                    
                    // In production, you might want to require additional verification
                    // For now, we'll log it but allow the login
                }
                
                logSecurityEvent('login_success', { userId: data.user.id, email, deviceFingerprint }, true);
            }

            return { error: null, user: data.user };
        } catch (error) {
            logSecurityEvent('login_error', { email, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: (error as Error).message } as AuthError };
        }
    };

    const logout = async () => {
        if (!supabase) return;
        const { error } = await supabase.auth.signOut();
        if (error) {
            if (process.env.NODE_ENV === 'development') {
              // eslint-disable-next-line no-console
              console.error('Logout error:', error);
            }
        }
    };

    // Validate signup input without creating user
    const validateSignupInput = useCallback((name: string, email: string, password: string): SecurityValidationResult => {
        const nameValidation = validateAndSanitizeName(name);
        const emailValidation = validateEmail(email);
        const passwordValidation = validatePassword(password);
        
        return {
            isValid: nameValidation.isValid && emailValidation.isValid && passwordValidation.isValid,
            nameValidation: { isValid: nameValidation.isValid, error: nameValidation.error },
            emailValidation,
            passwordValidation
        };
    }, []);

    // Reset rate limit for a specific identifier
    const resetRateLimit = useCallback((identifier: string) => {
      persistentRateLimitStore.delete(identifier);
    }, []);

    const signup = async (name: string, email: string, pass: string) => {
        if (!supabase) return { 
          error: { name: 'AuthApiError', message: 'Supabase not configured' } as AuthError, 
          user: null, 
          validation: undefined 
        };

        try {
            // Rate limiting check
            const rateLimitId = email; // In production, also consider IP
            const rateCheck = checkRateLimit(rateLimitId);
            if (!rateCheck.allowed) {
                return { 
                    error: { name: 'AuthApiError', message: rateCheck.message } as AuthError,
                    user: null,
                    validation: { isValid: false, rateLimit: rateCheck }
                };
            }

            // Validate input
            const nameValidation = validateAndSanitizeName(name);
            const emailValidation = validateEmail(email);
            const passwordValidation = validatePassword(pass);

            if (!nameValidation.isValid || !emailValidation.isValid || !passwordValidation.isValid) {
                const validation: SecurityValidationResult = {
                    isValid: false,
                    nameValidation: { isValid: nameValidation.isValid, error: nameValidation.error },
                    emailValidation,
                    passwordValidation
                };

                logSecurityEvent('signup_validation_failed', { email }, false);
                return { error: { name: 'ValidationError', message: 'Validation failed' } as AuthError, user: null, validation };
            }

            // Get device fingerprint
            const deviceFingerprint = getDeviceFingerprint();

            // Create user
            const { data, error } = await supabase.auth.signUp({
                email: emailValidation.isValid ? email.trim().toLowerCase() : email,
                password: pass,
                options: {
                    data: {
                        full_name: nameValidation.sanitized,
                        device_fingerprint: deviceFingerprint
                    }
                }
            });

            if (error) {
                logSecurityEvent('signup_failed', { email, reason: error.message }, false);
                if (import.meta.env.DEV) {
                    // eslint-disable-next-line no-console
                    console.warn('[signup] Supabase error:', error.message, error);
                }

                // Sanitize error messages to prevent user enumeration
                let sanitizedError = error.message;
                if (error.message.includes('User already registered')) {
                    sanitizedError = 'An account with this email already exists. Please sign in instead.';
                } else if (
                    /database error|saving new user|new user/i.test(error.message) ||
                    (error as { code?: string }).code === 'unexpected_failure'
                ) {
                    // Usually: public.users RLS blocks handle_new_user() trigger — apply
                    // supabase/migrations/fix_signup_handle_new_user_bypass_rls.sql on the project DB.
                    sanitizedError =
                        'Signup could not complete (database rejected the new profile). This is often fixed by applying the latest Supabase migration for handle_new_user. If you are the project admin, run the migration in SQL Editor or ask support.';
                }

                return { 
                    error: { name: error.name, message: sanitizedError } as AuthError,
                    user: null,
                    validation: {
                        isValid: false,
                        nameValidation: { isValid: nameValidation.isValid, error: nameValidation.error },
                        emailValidation: { isValid: emailValidation.isValid, error: emailValidation.error },
                        passwordValidation
                    }
                };
            }

            logSecurityEvent('signup_success', { email: rateLimitId, userId: data.user?.id, deviceFingerprint }, true);
            
            // Clear rate limit on successful signup
            persistentRateLimitStore.delete(rateLimitId);

            return { error: null, user: data?.user || null, validation: { isValid: true } };
        } catch (error) {
            logSecurityEvent('signup_error', { email, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: 'An unexpected error occurred' } as AuthError, user: null, validation: { isValid: false } };
        }
    };

    // 2FA Implementation
    const send2FACode = useCallback(async (userId: string) => {
        if (!supabase) return { error: { name: 'AuthApiError', message: 'Supabase not configured' } as AuthError };
        
        try {
            // Generate 6-digit code
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Store code with expiry (15 minutes)
            sessionStorage.setItem(`2fa_${userId}`, JSON.stringify({
                code,
                expires: Date.now() + 15 * 60 * 1000,
                attempts: 0
            }));
            
            // Send code via email (in production, use email service)
            logSecurityEvent('2fa_code_sent', { userId }, true);
            
            return { error: null };
        } catch (error) {
            logSecurityEvent('2fa_code_send_failed', { userId, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: 'Failed to send 2FA code' } as AuthError };
        }
    }, []);

    const verify2FACode = useCallback(async (code: string) => {
        if (!user) return { error: { name: 'AuthApiError', message: 'No user session' } as AuthError, success: false };
        
        try {
            const stored = sessionStorage.getItem(`2fa_${user.id}`);
            if (!stored) {
                return { error: { name: 'AuthApiError', message: 'No 2FA code found' } as AuthError, success: false };
            }
            
            const { code: storedCode, expires, attempts } = JSON.parse(stored);
            
            // Check expiry
            if (Date.now() > expires) {
                sessionStorage.removeItem(`2fa_${user.id}`);
                return { error: { name: 'AuthApiError', message: '2FA code expired' } as AuthError, success: false };
            }
            
            // Check attempts (max 3)
            if (attempts >= 3) {
                sessionStorage.removeItem(`2fa_${user.id}`);
                return { error: { name: 'AuthApiError', message: 'Too many failed attempts' } as AuthError, success: false };
            }
            
            // Verify code
            if (code === storedCode) {
                sessionStorage.removeItem(`2fa_${user.id}`);
                logSecurityEvent('2fa_success', { userId: user.id }, true);
                return { error: null, success: true };
            } else {
                // Update attempts
                const updated = { code: storedCode, expires, attempts: attempts + 1 };
                sessionStorage.setItem(`2fa_${user.id}`, JSON.stringify(updated));
                logSecurityEvent('2fa_failed', { userId: user.id, attempts: attempts + 1 }, false);
                return { error: { name: 'AuthApiError', message: 'Invalid 2FA code' } as AuthError, success: false };
            }
        } catch (error) {
            logSecurityEvent('2fa_verify_failed', { userId: user.id, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: 'Failed to verify 2FA code' } as AuthError, success: false };
        }
    }, [user]);

    const enable2FA = useCallback(async (method: 'email' | 'sms' | 'totp') => {
        if (!user) return { error: { name: 'AuthApiError', message: 'No user session' } as AuthError };
        
        try {
            setTwoFactorMethod(method);
            setIs2FAEnabled(true);
            
            // Store 2FA preference
            sessionStorage.setItem(`2fa_settings_${user.id}`, JSON.stringify({
                enabled: true,
                method
            }));
            
            logSecurityEvent('2fa_enabled', { userId: user.id, method }, true);
            
            // Send initial code
            return await send2FACode(user.id);
        } catch (error) {
            logSecurityEvent('2fa_enable_failed', { userId: user.id, method, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: 'Failed to enable 2FA' } as AuthError };
        }
    }, [user, send2FACode]);

    const disable2FA = useCallback(async () => {
        if (!user) return { error: { name: 'AuthApiError', message: 'No user session' } as AuthError };
        
        try {
            setIs2FAEnabled(false);
            setTwoFactorMethod(null);
            
            // Remove 2FA settings
            sessionStorage.removeItem(`2fa_settings_${user.id}`);
            sessionStorage.removeItem(`2fa_${user.id}`);
            
            logSecurityEvent('2fa_disabled', { userId: user.id }, true);
            
            return { error: null };
        } catch (error) {
            logSecurityEvent('2fa_disable_failed', { userId: user.id, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: 'Failed to disable 2FA' } as AuthError };
        }
    }, [user]);

    const resendVerificationEmail = async (email: string) => {
        if (!supabase) return { error: { name: 'AuthApiError', message: 'Supabase not configured' } as AuthError };
        
        try {
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email,
            });

            if (error) {
                logSecurityEvent('verification_email_failed', { email, reason: error.message }, false);
                return { error: { name: error.name, message: error.message } as AuthError };
            }

            logSecurityEvent('verification_email_sent', { email }, true);
            return { error: null };
        } catch (error) {
            logSecurityEvent('verification_email_error', { email, error: (error as Error).message }, false);
            return { error: { name: 'AuthApiError', message: 'Failed to resend verification email' } as AuthError };
        }
    };

    const refetchApprovalStatus = useCallback(async () => {
        if (user?.id) await fetchApprovalStatus(user.id);
    }, [user?.id, fetchApprovalStatus]);

    const value = {
        isAuthenticated: !!user,
        isApproved,
        user,
        session,
        login,
        logout,
        signup,
        validateSignupInput,
        resetRateLimit,
        isEmailVerified,
        resendVerificationEmail,
        send2FACode,
        verify2FACode,
        is2FAEnabled,
        twoFactorMethod,
        enable2FA,
        disable2FA,
        sessionExpiryTime,
        extendSession,
        isSessionExpiring,
        timeUntilExpiry,
        refetchApprovalStatus
    };
    
    if (loading) {
        return <div className="flex justify-center items-center h-screen bg-light"><div>Loading Authentication...</div></div>;
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

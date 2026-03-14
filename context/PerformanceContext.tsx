import React, { createContext, useState, useEffect, ReactNode } from 'react';

// Define MemoryInfo interface locally
interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface PerformanceContextType {
  isMobile: boolean;
  isSlowDevice: boolean;
  isLowBattery: boolean;
  isDataSaver: boolean;
  connectionType: string;
  memoryInfo: MemoryInfo | null;
  reduceMotion: boolean;
  enableAnimations: boolean;
  enableHighQualityImages: boolean;
  enableRealTimeUpdates: boolean;
  performanceMode: 'high' | 'balanced' | 'low';
  setPerformanceMode: (mode: 'high' | 'balanced' | 'low') => void;
  getOptimizedImageSrc: (src: string, quality?: number) => string;
  shouldDebounce: (delay?: number) => boolean;
  trackPerformance: (name: string, duration: number) => void;
  performanceMetrics: Record<string, number[]>;
}

const PerformanceContext = createContext<PerformanceContextType | null>(null);

export const usePerformance = () => {
  const context = React.useContext(PerformanceContext);
  if (!context) {
    throw new Error('usePerformance must be used within a PerformanceProvider');
  }
  return context;
};

interface PerformanceProviderProps {
  children: ReactNode;
}

export const PerformanceProvider: React.FC<PerformanceProviderProps> = ({ children }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isSlowDevice, setIsSlowDevice] = useState(false);
  const [isLowBattery, setIsLowBattery] = useState(false);
  const [isDataSaver, setIsDataSaver] = useState(false);
  const [connectionType, setConnectionType] = useState('unknown');
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [performanceMode, setPerformanceMode] = useState<'high' | 'balanced' | 'low'>('balanced');
  const [performanceMetrics, setPerformanceMetrics] = useState<Record<string, number[]>>({});

  // Detect device capabilities and preferences
  useEffect(() => {
    const detectDeviceCapabilities = () => {
      // Check if mobile
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     window.innerWidth <= 768;
      setIsMobile(mobile);

      // Check for slow device (based on hardware concurrency and memory)
      const isSlow = navigator.hardwareConcurrency <= 4 || 
                     (performance as any).memory?.totalJSHeapSize < 100 * 1024 * 1024; // Less than 100MB
      setIsSlowDevice(isSlow);

      // Check battery level
      if ('getBattery' in navigator) {
        (navigator as any).getBattery().then((battery: any) => {
          setIsLowBattery(battery.level < 0.2);
          battery.addEventListener('levelchange', () => {
            setIsLowBattery(battery.level < 0.2);
          });
        });
      }

      // Check data saver mode
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        setIsDataSaver(connection.saveData || false);
        setConnectionType(connection.effectiveType || 'unknown');
        
        connection.addEventListener('change', () => {
          setIsDataSaver(connection.saveData || false);
          setConnectionType(connection.effectiveType || 'unknown');
        });
      }

      // Check memory info
      if ('memory' in performance) {
        setMemoryInfo((performance as any).memory);
      }

      // Check for reduced motion preference
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setReduceMotion(prefersReducedMotion);

      // Auto-adjust performance mode based on device capabilities
      if (isSlow || isLowBattery || isDataSaver) {
        setPerformanceMode('low');
      } else if (mobile) {
        setPerformanceMode('balanced');
      } else {
        setPerformanceMode('high');
      }
    };

    detectDeviceCapabilities();

    // Listen for changes
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    mediaQuery.addEventListener('change', detectDeviceCapabilities);

    return () => {
      mediaQuery.removeEventListener('change', detectDeviceCapabilities);
    };
  }, []);

  // Performance monitoring
  useEffect(() => {
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === 'measure') {
            trackPerformance(entry.name, entry.duration);
          }
        });
      });

      observer.observe({ entryTypes: ['measure'] });

      return () => observer.disconnect();
    }
  }, []);

  const trackPerformance = (name: string, duration: number) => {
    setPerformanceMetrics(prev => ({
      ...prev,
      [name]: [...(prev[name] || []), duration].slice(-10) // Keep last 10 measurements
    }));
  };

  const getOptimizedImageSrc = (src: string, quality: number = 80): string => {
    if (!enableHighQualityImages) {
      quality = 50;
    }

    // Add optimization parameters for different image services
    if (src.includes('unsplash.com')) {
      return `${src}&w=400&h=300&fit=crop&auto=format&q=${quality}`;
    } else if (src.includes('cloudinary.com')) {
      return `${src.replace('/upload/', '/upload/w_400,h_300,c_fill,q_auto,f_auto/')}`;
    } else if (src.includes('images.unsplash.com')) {
      return `${src}&w=400&h=300&fit=crop&auto=format&q=${quality}`;
    }

    return src;
  };

  const shouldDebounce = (delay: number = 300): boolean => {
    return isSlowDevice || isLowBattery || performanceMode === 'low' || delay > 100;
  };

  const enableAnimations = performanceMode !== 'low' && !reduceMotion;
  const enableHighQualityImages = performanceMode === 'high' && !isDataSaver && !isLowBattery;
  const enableRealTimeUpdates = performanceMode !== 'low' && connectionType !== 'slow-2g';

  const value: PerformanceContextType = {
    isMobile,
    isSlowDevice,
    isLowBattery,
    isDataSaver,
    connectionType,
    memoryInfo,
    reduceMotion,
    enableAnimations,
    enableHighQualityImages,
    enableRealTimeUpdates,
    performanceMode,
    setPerformanceMode,
    getOptimizedImageSrc,
    shouldDebounce,
    trackPerformance,
    performanceMetrics
  };

  return React.createElement(
    PerformanceContext.Provider,
    { value },
    children
  );
};

export default PerformanceContext;

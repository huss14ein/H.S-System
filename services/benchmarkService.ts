/**
 * Benchmark Comparison Service
 * Fetches and compares portfolio performance against market benchmarks (S&P 500, NASDAQ)
 */

export interface BenchmarkData {
  symbol: string;
  name: string;
  currentValue: number;
  returnPct: number;
  date: Date;
}

export interface BenchmarkComparison {
  portfolioReturn: number;
  benchmarks: BenchmarkData[];
  outperformance: Record<string, number>; // Symbol -> outperformance %
}

const BENCHMARK_CACHE_KEY = 'benchmark-data:v1';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

/**
 * Fetch benchmark data from Finnhub or use cached data
 * For now, we'll use simulated data based on historical averages
 * In production, this would fetch real-time data from an API
 */
export async function fetchBenchmarkData(): Promise<BenchmarkData[]> {
  if (typeof window === 'undefined') return [];

  try {
    // Check cache first
    const cached = window.localStorage.getItem(BENCHMARK_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_DURATION) {
        return parsed.data.map((d: any) => ({
          ...d,
          date: new Date(d.date),
        }));
      }
    }

    // Simulate benchmark data (in production, fetch from API)
    // S&P 500 average annual return ~10%, NASDAQ ~12%
    // For 30-day period, approximate as monthly return
    const now = Date.now();
    const sp500Return = (10 / 12) + (Math.random() - 0.5) * 2; // ~0.83% monthly ±1%
    const nasdaqReturn = (12 / 12) + (Math.random() - 0.5) * 2; // ~1% monthly ±1%

    const benchmarks: BenchmarkData[] = [
      {
        symbol: 'SPY',
        name: 'S&P 500',
        currentValue: 100 * (1 + sp500Return / 100),
        returnPct: sp500Return,
        date: new Date(now),
      },
      {
        symbol: 'QQQ',
        name: 'NASDAQ-100',
        currentValue: 100 * (1 + nasdaqReturn / 100),
        returnPct: nasdaqReturn,
        date: new Date(now),
      },
    ];

    // Cache the data
    window.localStorage.setItem(BENCHMARK_CACHE_KEY, JSON.stringify({
      timestamp: now,
      data: benchmarks.map(b => ({
        ...b,
        date: b.date.toISOString(),
      })),
    }));

    return benchmarks;
  } catch (error) {
    console.warn('Failed to fetch benchmark data:', error);
    return [];
  }
}

/**
 * Calculate benchmark comparison
 */
export function calculateBenchmarkComparison(
  portfolioReturnPct: number,
  benchmarks: BenchmarkData[]
): BenchmarkComparison {
  const outperformance: Record<string, number> = {};
  
  benchmarks.forEach(benchmark => {
    outperformance[benchmark.symbol] = portfolioReturnPct - benchmark.returnPct;
  });

  return {
    portfolioReturn: portfolioReturnPct,
    benchmarks,
    outperformance,
  };
}

/**
 * Get benchmark performance for a specific time period
 * This would be enhanced with real API calls in production
 */
export async function getBenchmarkPerformance(): Promise<BenchmarkData[]> {
  return fetchBenchmarkData();
}

/**
 * Wealth Ultra Predictive Analytics Service
 * AI-powered market condition forecasts and allocation recommendations
 */

import { getAIMarketEventInsight } from './geminiService';

export interface MarketConditionForecast {
  timeframe: '1-week' | '1-month' | '3-months';
  outlook: 'bullish' | 'neutral' | 'bearish';
  confidence: 'high' | 'medium' | 'low';
  keyFactors: string[];
  recommendedAction: string;
  allocationAdjustment?: {
    coreAdjustment: number;
    upsideAdjustment: number;
    specAdjustment: number;
  };
}

export interface PredictiveInsight {
  marketForecast: MarketConditionForecast;
  portfolioRecommendation: string;
  riskAssessment: string;
  opportunities: string[];
  warnings: string[];
}

const CACHE_KEY = 'wealth-ultra-predictive-insight:v1';
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Generate AI-powered predictive analytics for Wealth Ultra
 */
export async function generatePredictiveAnalytics(
  portfolioValue: number,
  currentAllocations: Array<{ sleeve: string; marketValue: number }>,
  recentPerformance: Array<{ date: Date; value: number; returnPct: number }>
): Promise<PredictiveInsight | null> {
  if (typeof window === 'undefined') return null;
  
  try {
    // Check cache
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_DURATION) {
        return parsed.data;
      }
    }
    
    // Generate forecast based on recent performance
    const recentReturns = recentPerformance.slice(-7).map(p => p.returnPct);
    const avgReturn = recentReturns.length > 0
      ? recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length
      : 0;
    const volatility = recentReturns.length > 1
      ? Math.sqrt(recentReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / recentReturns.length)
      : 0;
    
    // Determine outlook based on performance
    let outlook: 'bullish' | 'neutral' | 'bearish' = 'neutral';
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    const keyFactors: string[] = [];
    
    if (avgReturn > 0.5 && volatility < 2) {
      outlook = 'bullish';
      confidence = 'high';
      keyFactors.push('Strong positive momentum');
      keyFactors.push('Low volatility indicates stability');
    } else if (avgReturn < -0.5 && volatility > 3) {
      outlook = 'bearish';
      confidence = 'high';
      keyFactors.push('Negative momentum');
      keyFactors.push('High volatility suggests uncertainty');
    } else {
      outlook = 'neutral';
      confidence = volatility > 2 ? 'low' : 'medium';
      keyFactors.push('Mixed signals');
      if (volatility > 2) {
        keyFactors.push('Elevated volatility');
      }
    }
    
    // Calculate allocation adjustments
    const coreAdjustment = outlook === 'bullish' ? 2 : outlook === 'bearish' ? -3 : 0;
    const upsideAdjustment = outlook === 'bullish' ? 3 : outlook === 'bearish' ? -2 : 0;
    const specAdjustment = outlook === 'bullish' ? -2 : outlook === 'bearish' ? 1 : 0;
    
    const marketForecast: MarketConditionForecast = {
      timeframe: '1-month',
      outlook,
      confidence,
      keyFactors,
      recommendedAction: outlook === 'bullish'
        ? 'Consider increasing upside sleeve allocation for growth opportunities'
        : outlook === 'bearish'
        ? 'Consider defensive positioning with higher core allocation'
        : 'Maintain current allocation strategy',
      allocationAdjustment: {
        coreAdjustment,
        upsideAdjustment,
        specAdjustment,
      },
    };
    
    const portfolioRecommendation = outlook === 'bullish'
      ? 'Portfolio shows strong momentum. Consider deploying additional capital to upside positions.'
      : outlook === 'bearish'
      ? 'Portfolio experiencing headwinds. Review positions and consider defensive measures.'
      : 'Portfolio is stable. Continue monitoring and maintain disciplined allocation.';
    
    const riskAssessment = volatility > 3
      ? 'Elevated risk detected. Consider reducing speculative exposure.'
      : volatility > 2
      ? 'Moderate risk levels. Monitor positions closely.'
      : 'Risk levels are manageable.';
    
    const opportunities: string[] = [];
    const warnings: string[] = [];
    
    if (outlook === 'bullish') {
      opportunities.push('Growth opportunities in tech and innovation sectors');
      opportunities.push('Consider increasing monthly deployment');
    } else if (outlook === 'bearish') {
      warnings.push('Market volatility may impact portfolio performance');
      warnings.push('Review stop-loss levels and exit targets');
    }
    
    if (volatility > 3) {
      warnings.push('High volatility detected - consider reducing leverage');
    }
    
    const insight: PredictiveInsight = {
      marketForecast,
      portfolioRecommendation,
      riskAssessment,
      opportunities,
      warnings,
    };
    
    // Cache the result
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data: insight,
    }));
    
    return insight;
  } catch (error) {
    console.warn('Failed to generate predictive analytics:', error);
    return null;
  }
}

/**
 * Get cached predictive insight
 */
export function getCachedPredictiveInsight(): PredictiveInsight | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_DURATION) {
        return parsed.data;
      }
    }
  } catch (error) {
    console.warn('Failed to get cached predictive insight:', error);
  }
  
  return null;
}

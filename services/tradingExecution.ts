/**
 * US Market Execution & Trading ("The Hands")
 * - Smart Order Routing (SOR) / NBBO stubs
 * - Extended hours guardrail (reject market orders outside 9:30–4:00 ET)
 * - Time-In-Force (TIF): Day, GTC, IOC
 * - VWAP execution logic (split order across time)
 */

export type TIF = 'DAY' | 'GTC' | 'IOC';
export type OrderType = 'MARKET' | 'LIMIT';

/** ET market hours (regular): 9:30–16:00. */
const REGULAR_OPEN_HOUR = 9;
const REGULAR_OPEN_MINUTE = 30;
const REGULAR_CLOSE_HOUR = 16;
const REGULAR_CLOSE_MINUTE = 0;

/**
 * Check if a given time (ET) is within regular market hours.
 * Input: hour (0–23), minute (0–59) in ET.
 */
export function isWithinRegularHoursET(hourET: number, minuteET: number): boolean {
  const openMins = REGULAR_OPEN_HOUR * 60 + REGULAR_OPEN_MINUTE;
  const closeMins = REGULAR_CLOSE_HOUR * 60 + REGULAR_CLOSE_MINUTE;
  const currentMins = hourET * 60 + minuteET;
  return currentMins >= openMins && currentMins < closeMins;
}

/**
 * Extended hours guardrail: reject market orders outside 9:30 AM – 4:00 PM ET.
 * Returns { allowed: false, reason } if order should be rejected.
 */
export interface ExtendedHoursCheckInput {
  orderType: OrderType;
  hourET: number;
  minuteET: number;
}

export function checkExtendedHoursGuardrail(input: ExtendedHoursCheckInput): { allowed: boolean; reason?: string } {
  if (input.orderType !== 'MARKET') {
    return { allowed: true };
  }
  const within = isWithinRegularHoursET(input.hourET, input.minuteET);
  if (!within) {
    return {
      allowed: false,
      reason: 'Market orders are only allowed during regular session (9:30 AM – 4:00 PM ET). Use a limit order for extended hours.',
    };
  }
  return { allowed: true };
}

/**
 * Time-In-Force engine: validate and describe TIF.
 */
export const TIF_LABELS: Record<TIF, string> = {
  DAY: "Day (valid until end of today's session)",
  GTC: "Good 'Til Canceled",
  IOC: 'Immediate-or-Cancel',
};

export function getTIFLabel(tif: TIF): string {
  return TIF_LABELS[tif] ?? tif;
}

/**
 * NBBO stub: in production would fetch best bid/offer across venues.
 */
export interface NBBOQuote {
  symbol: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp?: number;
}

export function getNBBOStub(symbol: string, lastPrice: number): NBBOQuote {
  const spread = lastPrice * 0.0005;
  return {
    symbol,
    bid: lastPrice - spread / 2,
    ask: lastPrice + spread / 2,
    bidSize: 100,
    askSize: 100,
    timestamp: Date.now(),
  };
}

/**
 * Smart Order Routing stub: in production would check liquidity across exchanges.
 */
export interface SORResult {
  recommendedVenue?: string;
  estimatedSlippageBps: number;
  useLimitOrder: boolean;
}

export function getSORStub(_symbol: string, _side: 'BUY' | 'SELL', quantity: number, lastPrice: number): SORResult {
  const notional = quantity * lastPrice;
  const slippageBps = notional > 100_000 ? 15 : notional > 50_000 ? 8 : 5;
  return {
    recommendedVenue: 'NYSE',
    estimatedSlippageBps: slippageBps,
    useLimitOrder: notional > 50_000,
  };
}

/**
 * VWAP: split a single order into N child slices to execute over the session.
 */
export interface VWAPSlice {
  quantity: number;
  targetTimeFraction: number; // 0–1 over the day
}

export function getVWAPSlices(totalQuantity: number, numSlices: number): VWAPSlice[] {
  const perSlice = totalQuantity / numSlices;
  const slices: VWAPSlice[] = [];
  for (let i = 0; i < numSlices; i++) {
    slices.push({
      quantity: i < numSlices - 1 ? perSlice : totalQuantity - perSlice * (numSlices - 1),
      targetTimeFraction: (i + 0.5) / numSlices,
    });
  }
  return slices;
}

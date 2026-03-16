/**
 * Risk, Compliance & Safety ("The Shield")
 * - PDT (Pattern Day Trader) tracker
 * - Value at Risk (VaR) – Historical Simulation
 * - T+1 settlement / settled cash
 * - Volatility-based position sizing
 * - Market holiday & hours (NYSE)
 */

/** Rolling 5-business-day day-trade counter. */
export interface PDTState {
  dayTradesInLast5Days: number;
  last5BusinessDays: string[]; // YYYY-MM-DD
  accountEquity: number;
}

const PDT_THRESHOLD_EQUITY = 25_000;
const PDT_MAX_DAY_TRADES = 3;

/**
 * Check if adding one more day trade would violate PDT (4th day trade in 5 business days when equity < 25k).
 */
export function wouldViolatePDT(state: PDTState): boolean {
  if (state.accountEquity >= PDT_THRESHOLD_EQUITY) return false;
  return state.dayTradesInLast5Days >= PDT_MAX_DAY_TRADES;
}

export function getPDTStatus(state: PDTState): { allowed: boolean; reason: string; dayTradesLeft: number } {
  if (state.accountEquity >= PDT_THRESHOLD_EQUITY) {
    return { allowed: true, reason: 'Account equity meets $25k; PDT rule does not apply.', dayTradesLeft: 999 };
  }
  const left = Math.max(0, PDT_MAX_DAY_TRADES - state.dayTradesInLast5Days);
  return {
    allowed: left > 0,
    reason: left > 0
      ? `Up to ${left} day trade(s) left in rolling 5 business days (equity < $25,000).`
      : 'PDT limit: 4th day trade in 5 business days would trigger 90-day restriction. Equity < $25,000.',
    dayTradesLeft: left,
  };
}

/**
 * Value at Risk (VaR) – Historical Simulation, 95% confidence.
 * Returns: "With 95% certainty, you will not lose more than $X today."
 */
export function valueAtRiskHistorical(
  positionValues: number[],
  historicalReturns: number[][],
  confidenceLevel: number = 0.95
): { varAmount: number; varPercent: number; message: string } {
  if (positionValues.length === 0 || historicalReturns.length === 0) {
    return { varAmount: 0, varPercent: 0, message: 'Insufficient data for VaR.' };
  }
  const portfolioReturns: number[] = [];
  for (let i = 0; i < historicalReturns.length; i++) {
    let dailyReturn = 0;
    let totalVal = 0;
    for (let j = 0; j < positionValues.length; j++) {
      const ret = historicalReturns[j]?.[i] ?? 0;
      totalVal += positionValues[j] ?? 0;
      dailyReturn += (positionValues[j] ?? 0) * ret;
    }
    portfolioReturns.push(totalVal > 0 ? dailyReturn / totalVal : 0);
  }
  portfolioReturns.sort((a, b) => a - b);
  const idx = Math.floor((1 - confidenceLevel) * portfolioReturns.length);
  const varReturn = portfolioReturns[Math.max(0, idx)] ?? 0;
  const totalValue = positionValues.reduce((s, v) => s + v, 0);
  const varAmount = Math.abs(Math.min(0, varReturn) * totalValue);
  const varPercent = totalValue > 0 ? (varAmount / totalValue) * 100 : 0;
  return {
    varAmount,
    varPercent,
    message: `With ${confidenceLevel * 100}% certainty, you will not lose more than $${varAmount.toFixed(0)} (${varPercent.toFixed(2)}%) today.`,
  };
}

/**
 * T+1 settlement: track settled cash. Selling before funds settle violates good faith.
 */
export interface SettlementState {
  pendingBuyAmount: number;
  pendingSettleDate: string; // YYYY-MM-DD
}

/** Business days (simple: exclude weekend). */
function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

export function getSettlementDate(tradeDate: Date): string {
  const settled = addBusinessDays(tradeDate, 1);
  return settled.toISOString().slice(0, 10);
}

export function isSettled(settlementState: SettlementState, asOfDate: string): boolean {
  return settlementState.pendingSettleDate <= asOfDate || settlementState.pendingBuyAmount <= 0;
}

/**
 * Volatility-based position sizing: inverse-vol weighting so total portfolio risk is constant.
 */
export function volatilityAdjustedWeights(
  volatilities: number[],
  targetTotalRisk: number
): number[] {
  if (volatilities.length === 0) return [];
  const invVol = volatilities.map((v) => (v > 0 ? 1 / v : 0));
  const sum = invVol.reduce((s, x) => s + x, 0);
  if (sum === 0) return volatilities.map(() => 1 / volatilities.length);
  const weights = invVol.map((x) => x / sum);
  const portfolioVol = Math.sqrt(
    weights.reduce((s, w, i) => s + w * w * (volatilities[i] * volatilities[i]), 0)
  );
  const scale = portfolioVol > 0 ? targetTotalRisk / portfolioVol : 1;
  return weights.map((w) => w * scale);
}

/**
 * NYSE holidays (common set; partial). Use for "no trade" guardrail.
 */
const NYSE_HOLIDAYS: string[] = [
  '01-01', // New Year
  '01-20', // MLK (3rd Mon – approximate)
  '02-17', // Presidents (3rd Mon – approximate)
  '04-18', // Good Friday (approx)
  '05-26', // Memorial (last Mon – approx)
  '06-19', // Juneteenth
  '07-04', // Independence
  '09-01', // Labor (1st Mon – approx)
  '11-28', // Thanksgiving (4th Thu – approx)
  '12-25', // Christmas
];

function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function getMMDD(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isNYSEHolidayOrWeekend(date: Date): boolean {
  if (isWeekend(date)) return true;
  const mmdd = getMMDD(date);
  return NYSE_HOLIDAYS.some((h) => h === mmdd);
}

export function getMarketHoursGuardrail(date: Date, hourET: number, minuteET: number): { allowed: boolean; reason?: string } {
  if (isNYSEHolidayOrWeekend(date)) {
    return { allowed: false, reason: 'Market is closed (NYSE holiday or weekend).' };
  }
  const openMins = 9 * 60 + 30;
  const closeMins = 16 * 60;
  const currentMins = hourET * 60 + minuteET;
  if (currentMins < openMins || currentMins >= closeMins) {
    return { allowed: false, reason: 'Outside regular trading hours (9:30 AM – 4:00 PM ET).' };
  }
  return { allowed: true };
}

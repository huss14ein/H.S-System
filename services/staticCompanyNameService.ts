/**
 * Static fallback for company names when Finnhub is unavailable, rate-limited,
 * or returns no data (e.g. non-US symbols on free tier). Ensures auto-retrieve
 * always provides a display name.
 */

const STATIC_SYMBOL_NAMES: Record<string, string> = {
  // US – major
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corporation',
  GOOGL: 'Alphabet Inc. (Google)',
  GOOG: 'Alphabet Inc. (Google)',
  AMZN: 'Amazon.com Inc.',
  NVDA: 'NVIDIA Corporation',
  META: 'Meta Platforms Inc.',
  TSLA: 'Tesla Inc.',
  'BRK.B': 'Berkshire Hathaway Inc.',
  BRKB: 'Berkshire Hathaway Inc.',
  JPM: 'JPMorgan Chase & Co.',
  V: 'Visa Inc.',
  JNJ: 'Johnson & Johnson',
  WMT: 'Walmart Inc.',
  PG: 'Procter & Gamble Co.',
  MA: 'Mastercard Incorporated',
  UNH: 'UnitedHealth Group Inc.',
  HD: 'The Home Depot Inc.',
  DIS: 'The Walt Disney Company',
  PYPL: 'PayPal Holdings Inc.',
  NFLX: 'Netflix Inc.',
  ADBE: 'Adobe Inc.',
  CRM: 'Salesforce Inc.',
  INTC: 'Intel Corporation',
  AMD: 'Advanced Micro Devices Inc.',
  CSCO: 'Cisco Systems Inc.',
  PEP: 'PepsiCo Inc.',
  KO: 'The Coca-Cola Company',
  COST: 'Costco Wholesale Corporation',
  ABBV: 'AbbVie Inc.',
  TMO: 'Thermo Fisher Scientific Inc.',
  NEE: 'NextEra Energy Inc.',
  DHR: 'Danaher Corporation',
  AVGO: 'Broadcom Inc.',
  MCD: "McDonald's Corporation",
  TXN: 'Texas Instruments Inc.',
  NKE: 'Nike Inc.',
  PM: 'Philip Morris International Inc.',
  BMY: 'Bristol-Myers Squibb Company',
  HON: 'Honeywell International Inc.',
  WFC: 'Wells Fargo & Company',
  UPS: 'United Parcel Service Inc.',
  RTX: 'RTX Corp',
  QCOM: 'QUALCOMM Incorporated',
  AMGN: 'Amgen Inc.',
  CAT: 'Caterpillar Inc.',
  IBM: 'International Business Machines Corporation',
  GE: 'General Electric Company',
  BA: 'The Boeing Company',
  GILD: 'Gilead Sciences Inc.',
  SPY: 'SPDR S&P 500 ETF Trust',
  QQQ: 'Invesco QQQ Trust',
  VOO: 'Vanguard S&P 500 ETF',
  // Saudi Tadawul (common)
  '1120.SR': 'Al Rajhi Bank',
  '1180.SR': 'Saudi National Bank',
  '1010.SR': 'Saudi Basic Industries Corporation (SABIC)',
  '2222.SR': 'Saudi Arabian Oil Company (Aramco)',
  '2010.SR': 'Saudi Cement Company',
  '1182.SR': 'Riyad Bank',
  '1120.SA': 'Al Rajhi Bank',
  '1180.SA': 'Saudi National Bank',
  '2222.SA': 'Saudi Arabian Oil Company (Aramco)',
  '7010.SR': 'Saudi Telecom Company',
  'REITF.SR': 'Al Jazira REIT Fund',
  // Crypto (display)
  BTC: 'Bitcoin',
  'BTC-USD': 'Bitcoin',
  ETH: 'Ethereum',
  'ETH-USD': 'Ethereum',
};

/** Normalize symbol for lookup (upper, trim). Tadawul TADAWUL:1234 -> 1234.SR */
function normalizeKey(symbol: string): string {
  const s = (symbol || '').trim().toUpperCase();
  if (!s) return s;
  const tadawulMatch = s.match(/^TADAWUL:([0-9]{4,6})$/);
  if (tadawulMatch) return `${tadawulMatch[1]}.SR`;
  return s;
}

/** Canonical key for company-name cache, Finnhub, and static map (one listing per line). */
export function normalizeSymbolKeyForCompanyLookup(symbol: string): string {
  return normalizeKey(symbol);
}

/**
 * Return company name from static map when API is unavailable.
 * Used so auto-retrieve always has a fallback.
 */
export function getStaticCompanyName(symbol: string): string | null {
  const key = normalizeKey(symbol);
  if (!key || key.length < 2) return null;
  return STATIC_SYMBOL_NAMES[key] ?? null;
}

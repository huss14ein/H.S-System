// Test Investment Overview calculations and data accuracy
import { toSAR } from './utils/currencyMath';

// Test currency conversion logic
console.log('=== Testing Currency Conversion ===');
const exchangeRate = 3.75; // SAR to USD

// Test USD to SAR conversion
const usdAmount = 1000;
const sarAmount = toSAR(usdAmount, 'USD', exchangeRate);
console.log(`${usdAmount} USD = ${sarAmount} SAR (expected: ${usdAmount * exchangeRate})`);

// Test SAR to SAR conversion (should be unchanged)
const sarOriginal = 1000;
const sarConverted = toSAR(sarOriginal, 'SAR', exchangeRate);
console.log(`${sarOriginal} SAR = ${sarConverted} SAR (expected: ${sarOriginal})`);

// Test undefined currency (should default to USD)
const undefinedAmount = 500;
const undefinedConverted = toSAR(undefinedAmount, undefined, exchangeRate);
console.log(`${undefinedAmount} undefined = ${undefinedConverted} SAR (expected: ${undefinedAmount * exchangeRate})`);

// Test edge cases
console.log('\n=== Testing Edge Cases ===');
console.log('NaN input:', toSAR(NaN, 'USD', exchangeRate));
console.log('Infinity input:', toSAR(Infinity, 'USD', exchangeRate));
console.log('Negative input:', toSAR(-100, 'USD', exchangeRate));
console.log('Zero input:', toSAR(0, 'USD', exchangeRate));

// Test portfolio value calculation logic
console.log('\n=== Testing Portfolio Value Logic ===');
const mockPortfolio = {
  currency: 'USD' as const,
  holdings: [
    { symbol: 'AAPL', quantity: 10, avgCost: 150, currentValue: 1550 },
    { symbol: 'GOOGL', quantity: 5, avgCost: 200, currentValue: 1050 },
    { symbol: 'TSLA', quantity: 2, avgCost: 300, currentValue: 0 } // No current value
  ]
};

const portfolioValueUSD = mockPortfolio.holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
const portfolioValueSAR = toSAR(portfolioValueUSD, mockPortfolio.currency, exchangeRate);

console.log(`Portfolio value USD: ${portfolioValueUSD}`);
console.log(`Portfolio value SAR: ${portfolioValueSAR}`);
console.log(`Expected SAR: ${portfolioValueUSD * exchangeRate}`);

// Test gain/loss calculation
console.log('\n=== Testing Gain/Loss Calculation ===');
const mockHolding = {
  symbol: 'AAPL',
  quantity: 10,
  avgCost: 150,
  currentValue: 1550,
  portfolioCurrency: 'USD' as const
};

const costValue = mockHolding.avgCost * mockHolding.quantity;
const gainLossUSD = mockHolding.currentValue - costValue;
const gainLossPercent = (gainLossUSD / costValue) * 100;
const gainLossSAR = toSAR(gainLossUSD, mockHolding.portfolioCurrency, exchangeRate);

console.log(`Cost value: ${costValue} USD`);
console.log(`Current value: ${mockHolding.currentValue} USD`);
console.log(`Gain/Loss USD: ${gainLossUSD} (${gainLossPercent.toFixed(2)}%)`);
console.log(`Gain/Loss SAR: ${gainLossSAR} (expected: ${gainLossUSD * exchangeRate})`);

// Test HHI (Herfindahl-Hirschman Index) calculation
console.log('\n=== Testing HHI Calculation ===');
const weights = [0.4, 0.3, 0.2, 0.1]; // Sum = 1.0
const hhi = weights.reduce((acc, w) => acc + w * w, 0);
const effectiveHoldings = 1 / hhi;

console.log(`Weights: [${weights.join(', ')}]`);
console.log(`HHI: ${hhi.toFixed(3)}`);
console.log(`Effective holdings: ${effectiveHoldings.toFixed(1)}`);

// Test concentration warnings
console.log('\n=== Testing Concentration Warnings ===');
const warnings = [];
const topHoldingPct = 30;
const topAssetClassPct = 65;

if (topHoldingPct > 25) warnings.push(`Top holding concentration is high (${topHoldingPct.toFixed(1)}%).`);
if (topAssetClassPct > 60) warnings.push(`Top asset class concentration is high (${topAssetClassPct.toFixed(1)}%).`);
if (effectiveHoldings < 8) warnings.push(`Effective diversification is low (${effectiveHoldings.toFixed(1)} equivalent holdings).`);

console.log('Warnings generated:');
warnings.forEach(warning => console.log(`- ${warning}`));

const status = warnings.length === 0 ? 'healthy' : warnings.length === 1 ? 'watch' : 'alert';
console.log(`Overall status: ${status}`);

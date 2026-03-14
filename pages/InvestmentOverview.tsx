import React from 'react';
import { DataContext } from '../context/DataContext';
import SectionCard from '../components/SectionCard';
import { useFormatCurrency } from '../hooks/useFormatCurrency';

/** Minimal overview tab for Investments: total value and portfolio list. */
const InvestmentOverview: React.FC = () => {
  const { data } = React.useContext(DataContext)!;
  const { formatCurrencyString } = useFormatCurrency();
  const portfolios = data?.investments ?? [];
  const totalValue = React.useMemo(() => {
    return portfolios.reduce((sum, p) => {
      const portVal = (p.holdings ?? []).reduce((s, h) => s + (h.currentValue ?? 0), 0);
      return sum + portVal;
    }, 0);
  }, [portfolios]);

  return (
    <SectionCard title="Investment overview">
      <p className="text-slate-600 mb-4">
        Total portfolio value: <strong className="text-slate-900">{formatCurrencyString(totalValue)}</strong>
      </p>
      <p className="text-sm text-slate-500">
        Use the Portfolios, Investment Plan, and other tabs to manage holdings and plans.
      </p>
    </SectionCard>
  );
};

export default InvestmentOverview;

import React, { useMemo } from 'react';
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import ChartContainer from '../charts/ChartContainer';

type MerchantRow = { merchant: string; total: number };

type Props = {
  merchants: MerchantRow[];
  onMerchantClick?: (merchant: string) => void;
  maxItems?: number;
};

const MerchantTreemapContent: React.FC<any> = (props) => {
  const { x, y, width, height, name, depth } = props;
  if (depth !== 1 || width < 4 || height < 4) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="var(--color-primary, #4f46e5)"
        fillOpacity={0.75}
        stroke="#fff"
        strokeWidth={2}
        rx={4}
        className="cursor-pointer"
      />
      {width > 48 && height > 20 && (
        <text x={x + 6} y={y + 16} fill="#fff" fontSize={11} fontWeight={600}>
          {String(name).length > 14 ? `${String(name).slice(0, 12)}…` : name}
        </text>
      )}
    </g>
  );
};

export const SpendingMerchantTreemap: React.FC<Props> = ({
  merchants,
  onMerchantClick,
  maxItems = 20,
}) => {
  const { formatCurrencyString } = useFormatCurrency();
  const chartData = useMemo(
    () =>
      merchants
        .filter((m) => m.total > 0)
        .slice(0, maxItems)
        .map((m) => ({ name: m.merchant, size: m.total })),
    [merchants, maxItems],
  );

  return (
    <ChartContainer height={280} isEmpty={!chartData.length} emptyMessage="No merchant spend in this period.">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={chartData}
          dataKey="size"
          nameKey="name"
          stroke="#fff"
          fill="#4f46e5"
          content={<MerchantTreemapContent />}
          onClick={(node: { name?: string }) => node?.name && onMerchantClick?.(node.name)}
        >
          <Tooltip
            formatter={(value: number) => [formatCurrencyString(value, { digits: 0 }), 'Spent']}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '8px 12px',
            }}
          />
        </Treemap>
      </ResponsiveContainer>
    </ChartContainer>
  );
};

export default SpendingMerchantTreemap;

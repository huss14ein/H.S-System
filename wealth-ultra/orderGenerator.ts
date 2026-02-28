import type { WealthUltraPosition, WealthUltraOrder } from '../types';

export function generateOrders(positions: WealthUltraPosition[]): WealthUltraOrder[] {
  const orders: WealthUltraOrder[] = [];

  for (const pos of positions) {
    const plannedShares = pos.plannedAddedShares ?? 0;
    if (plannedShares > 0 && pos.buy1Price != null) {
      orders.push({
        type: 'BUY',
        ticker: pos.ticker,
        qty: plannedShares,
        limitPrice: pos.buy1Price,
        orderType: 'LIMIT',
        tif: 'GTC',
      });
    }

    if (pos.currentShares > 0 && (pos.applyTarget1 || pos.applyTarget2 || pos.applyTrailing)) {
      orders.push({
        type: 'SELL',
        ticker: pos.ticker,
        qty: pos.currentShares,
        orderType: 'LIMIT',
        tif: 'GTC',
        target1Price: pos.applyTarget1 ? pos.target1Price : undefined,
        target2Price: pos.applyTarget2 ? pos.target2Price : undefined,
        trailingStopPrice: pos.applyTrailing ? pos.trailingStopPrice : undefined,
      });
    }
  }

  return orders;
}

export function exportOrdersJson(orders: WealthUltraOrder[]): string {
  return JSON.stringify(orders, null, 2);
}

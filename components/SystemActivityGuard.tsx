import React from 'react';

/**
 * Live prices are now manual-trigger only (Header refresh button).
 * Keep this component mounted as a future extension point, but do not auto-refresh on focus/visibility/interval.
 */
export const SystemActivityGuard: React.FC = () => null;

export default SystemActivityGuard;

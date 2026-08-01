import React from 'react';

/**
 * Live quotes run only on user-initiated refresh (Header Sync / Investments Sync quotes).
 * On hydrate: restore localStorage + DB holding prices + market_quote_cache — never auto-fetch APIs.
 */
export const SystemActivityGuard: React.FC = () => null;

export default SystemActivityGuard;

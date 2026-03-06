import React from 'react';

/**
 * Manual-only live prices mode:
 * keep component mounted as an extension point, but do not auto-refresh on
 * focus/visibility/interval. Refresh is user-triggered from UI controls only.
 */
export const SystemActivityGuard: React.FC = () => null;

export default SystemActivityGuard;

#!/usr/bin/env node
/**
 * One command for performance-recovery automated gates (CI + local).
 * Manual preview steps: docs/PERFORMANCE_RECOVERY_E2E.md
 */
import { spawnSync } from 'node:child_process';

const steps = [
  {
    name: 'Static wiring (vitest)',
    cmd: 'npx',
    args: [
      'vitest',
      'run',
      'tests/performanceRecoveryCoverage.vitest.test.ts',
      'tests/planDashboardCompare.vitest.test.ts',
      'tests/planDashboardCompareContext.vitest.test.ts',
      'tests/quoteEdgeCache.vitest.test.ts',
      'tests/planExpenseOutliers.vitest.test.ts',
      'tests/holdingValuationClamp.vitest.test.ts',
      'tests/pageLoadingGateCoverage.vitest.test.ts',
      'tests/statementProcessingPersist.vitest.test.ts',
      'tests/netWorthSnapshotThrottle.vitest.test.ts',
    ],
  },
  {
    name: 'Full unit suite',
    cmd: 'npm',
    args: ['run', 'test:unit'],
  },
];

let failed = false;
for (const step of steps) {
  console.log(`\n▶ ${step.name}`);
  const r = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    failed = true;
    console.error(`✗ ${step.name} failed`);
  } else {
    console.log(`✓ ${step.name}`);
  }
}

console.log('\n---');
if (failed) {
  console.error('Performance recovery verification failed.');
  process.exit(1);
}
console.log('Automated gates passed.');
console.log('Optional browser E2E: npm run test:e2e -- e2e/performance-recovery.spec.ts');
console.log('Preview manual checklist: docs/PERFORMANCE_RECOVERY_E2E.md');

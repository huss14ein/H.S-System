import { describe, expect, it } from 'vitest';
import { formatUniverseMonthlyWeightFraction, getUniversePlanRoleLabel, getUniverseRowPlanRole } from '../services/universePlanRole';

describe('formatUniverseMonthlyWeightFraction', () => {
  it('converts 0–1 fraction to percent', () => {
    expect(formatUniverseMonthlyWeightFraction(0.25)).toBe('25.0%');
  });
  it('passes through legacy percent-style values', () => {
    expect(formatUniverseMonthlyWeightFraction(25)).toBe('25.0%');
  });
});

describe('getUniversePlanRoleLabel', () => {
  it('maps Core', () => {
    expect(getUniversePlanRoleLabel('Core')).toBe('In monthly rotation');
  });
});

describe('getUniverseRowPlanRole', () => {
  it('returns mapping when not in universe', () => {
    expect(getUniverseRowPlanRole({ status: 'Core', source: 'Holding' })).toBe('Needs universe mapping');
  });
  it('returns role when in universe', () => {
    expect(getUniverseRowPlanRole({ status: 'Core', source: 'Universe' })).toBe('In monthly rotation');
  });
});

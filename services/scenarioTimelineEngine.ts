import type { FinancialData } from '../types';

export interface ScenarioTimelineEvent {
  yearOffset: number;
  label: string;
  narrative: string;
}

export interface ScenarioTimeline {
  horizonYears: number;
  events: ScenarioTimelineEvent[];
}

export function buildBaselineScenarioTimeline(
  data: FinancialData | null | undefined,
  horizonYears: number,
  projectedNetWorth: number
): ScenarioTimeline {
  const goals = data?.goals ?? [];

  const events: ScenarioTimelineEvent[] = [];

  const midYear = Math.floor(horizonYears / 2);
  if (goals.length > 0) {
    events.push({
      yearOffset: 0,
      label: 'Today',
      narrative: 'You are tracking multiple goals; your plan will gradually convert savings into goal funding and investments.',
    });
    events.push({
      yearOffset: midYear,
      label: `Year ${midYear}`,
      narrative:
        'Midway through the forecast, higher savings and compounding investments dominate your progress. Review priorities and adjust funding between goals.',
    });
  }

  events.push({
    yearOffset: horizonYears,
    label: `Year ${horizonYears}`,
    narrative: `By year ${horizonYears}, projected net worth reaches approximately ${Math.round(
      projectedNetWorth
    ).toLocaleString()} in your plan currency under current assumptions.`,
  });

  return { horizonYears, events };
}


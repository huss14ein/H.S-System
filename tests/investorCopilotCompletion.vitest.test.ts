import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('investorCopilotCompletion', () => {
  it('geminiService imports aiActionCards helpers', () => {
    const src = read('services/geminiService.ts');
    expect(src).toMatch(/from ['"]\.\/aiActionCards['"]/);
    expect(src).toContain('actionCardsPromptFooter');
    expect(src).toContain('withAdviceAndActionCards');
    expect(src).toContain('wealthPromptWithPageDelta');
  });

  it('AIAdvisor imports AiActionCardsPanel', () => {
    const src = read('components/AIAdvisor.tsx');
    expect(src).toMatch(/AiActionCardsPanel/);
    expect(src).toMatch(/from ['"]\.\/AiActionCardsPanel['"]/);
  });

  it('LiveAdvisor has getInvestmentRoi Phase B tool', () => {
    const src = read('components/LiveAdvisorModal.tsx');
    expect(src).toContain('getInvestmentRoi');
    expect(src).toContain('getLiquidityRunway');
    expect(src).toContain('proposeTrade');
    expect(src).toContain('finova_live_advisor_history_v1');
    expect(src).toContain('AiActionCardsPanel');
    expect(src).toContain('remainingToolRounds = 8');
  });

  it('Layout registers AI action navigator', () => {
    const src = read('components/Layout.tsx');
    expect(src).toContain('registerAiActionNavigator');
  });

  it('TransactionAIContext imports getAICategorySuggestion from geminiService', () => {
    const src = read('context/TransactionAIContext.tsx');
    expect(src).toMatch(/getAICategorySuggestion.*from ['"]\.\.\/services\/geminiService['"]/);
  });

  it('summary case configured for Investor Copilot', () => {
    const advisor = read('components/AIAdvisor.tsx');
    expect(advisor).toContain("case 'summary'");
    expect(advisor).toContain('getAIExecutiveSummary');
    const summary = read('pages/Summary.tsx');
    expect(summary).toMatch(/pageContext=["']summary["']/);
  });

  it('specialist engines accept wealth grounding / action cards', () => {
    const src = read('services/geminiService.ts');
    expect(src).toContain('getInvestmentAIAnalysis');
    expect(src).toContain('getAIInvestmentOverviewAnalysis');
    expect(src).toContain('concentrationWarnings');
    expect(src).toContain('deployableCashSar');
    expect(src).toContain('wealthGroundingPrompt');
    expect(src).toContain('Portfolio fit advice');
  });

  it('proactive feed refresh event wiring exists', () => {
    const triggers = read('services/aiFeedTriggers.ts');
    expect(triggers).toContain('markAiFeedStale');
    expect(triggers).toContain('finova:ai-feed-refresh');
    const feed = read('components/AIFeed.tsx');
    expect(feed).toContain('AI_FEED_REFRESH_EVENT');
    const investments = read('pages/Investments.tsx');
    expect(investments).toContain('requestAiFeedRefresh');
  });

  it('orphan AI exports are marked deprecated', () => {
    const src = read('services/geminiService.ts');
    expect(src).toMatch(/@deprecated Unused orphan[\s\S]*getAIStrategy/);
    expect(src).toMatch(/@deprecated Unused orphan[\s\S]*getAIResearchNews/);
  });

  it('Dashboard Ask Copilot and openLiveAdvisor exist', () => {
    expect(read('pages/Dashboard.tsx')).toContain('openLiveAdvisor');
    expect(read('utils/openLiveAdvisor.ts')).toContain('finova:open-live-advisor');
    expect(read('components/Layout.tsx')).toContain('OPEN_LIVE_ADVISOR_EVENT');
  });
});

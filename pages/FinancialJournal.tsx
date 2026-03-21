import React, { useState, useEffect, useMemo } from 'react';
import { useSelfLearning } from '../context/SelfLearningContext';
import PageLayout from '../components/PageLayout';
import SectionCard from '../components/SectionCard';
import type { Page } from '../types';
import {
  createThesisRecord,
  thesisValidityCheck,
  journalOutcomeReview,
  type ThesisRecord,
} from '../services/thesisJournalEngine';

const KEY = 'finova_financial_journal_v1';
const THESIS_KEY = 'finova_thesis_records_v1';

interface JournalEntry {
  id: string;
  at: string;
  title: string;
  body: string;
}

function load(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(entries: JournalEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {}
}

interface FinancialJournalProps {
  setActivePage?: (p: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
  dataTick?: number;
}

const FinancialJournal: React.FC<FinancialJournalProps> = ({ triggerPageAction }) => {
  const { trackAction } = useSelfLearning();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => setEntries(load()), []);

  const sorted = useMemo(() => [...entries].sort((a, b) => b.at.localeCompare(a.at)), [entries]);

  const loadTheses = (): ThesisRecord[] => {
    try {
      const raw = localStorage.getItem(THESIS_KEY);
      return raw ? (JSON.parse(raw) as ThesisRecord[]) : [];
    } catch {
      return [];
    }
  };

  const saveTheses = (records: ThesisRecord[]) => {
    try {
      localStorage.setItem(THESIS_KEY, JSON.stringify(records.slice(0, 200)));
    } catch {}
  };

  const [theses, setTheses] = useState<ThesisRecord[]>([]);
  useEffect(() => setTheses(loadTheses()), []);

  const [symbol, setSymbol] = useState('');
  const [buyThesis, setBuyThesis] = useState('');
  const [expectedUpsidePct, setExpectedUpsidePct] = useState<string>('');
  const [expectedTimeline, setExpectedTimeline] = useState('');
  const [keyRisks, setKeyRisks] = useState('');
  const [catalystDates, setCatalystDates] = useState('');
  const [invalidationPoint, setInvalidationPoint] = useState('');
  const [reviewDate, setReviewDate] = useState('');

  const addThesis = () => {
    trackAction('add-thesis', 'Engines & Tools');
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const record = createThesisRecord({
      symbol: sym,
      buyThesis: buyThesis.trim() || '',
      expectedUpsidePct: expectedUpsidePct ? Number(expectedUpsidePct) : undefined,
      expectedTimeline: expectedTimeline.trim() || undefined,
      keyRisks: keyRisks.trim() || undefined,
      catalystDates: catalystDates.trim() || undefined,
      invalidationPoint: invalidationPoint.trim() || undefined,
      reviewDate: reviewDate.trim() || undefined,
    });
    const next = [record, ...theses.filter((t) => (t.symbol || '').toUpperCase() !== sym)];
    setTheses(next);
    saveTheses(next);

    setSymbol('');
    setBuyThesis('');
    setExpectedUpsidePct('');
    setExpectedTimeline('');
    setKeyRisks('');
    setCatalystDates('');
    setInvalidationPoint('');
    setReviewDate('');
  };

  const [outcomeSymbol, setOutcomeSymbol] = useState('');
  const [actualReturnPct, setActualReturnPct] = useState<string>('');
  const [reflection, setReflection] = useState('');
  useEffect(() => {
    if (!outcomeSymbol && theses[0]?.symbol) setOutcomeSymbol(theses[0].symbol);
  }, [theses, outcomeSymbol]);

  const recordOutcome = () => {
    const sym = outcomeSymbol.trim().toUpperCase();
    if (!sym) return;
    const idx = theses.findIndex((t) => (t.symbol || '').toUpperCase() === sym);
    if (idx < 0) return;
    const ret = Number(actualReturnPct);
    if (!Number.isFinite(ret)) return;
    const nextTheses = [...theses];
    const updated = journalOutcomeReview({
      thesis: nextTheses[idx],
      actualReturnPct: ret,
      reflection: reflection.trim() || '',
    } as any);
    nextTheses[idx] = updated;
    setTheses(nextTheses);
    saveTheses(nextTheses);

    setActualReturnPct('');
    setReflection('');
  };

  const recordOutcomeWithTracking = () => {
    trackAction('record-outcome', 'Engines & Tools');
    recordOutcome();
  };

  const add = () => {
    if (!title.trim() && !body.trim()) return;
    trackAction('add-journal-note', 'Engines & Tools');
    const e: JournalEntry = {
      id: `j-${Date.now()}`,
      at: new Date().toISOString(),
      title: title.trim() || 'Note',
      body: body.trim(),
    };
    const next = [e, ...entries];
    setEntries(next);
    save(next);
    setTitle('');
    setBody('');
  };

  return (
    <PageLayout
      title="Notes & ideas"
      description="Write down why you bought each investment and when to revisit it. Stored only on this device—your private notes."
    >
      <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
        <p className="text-sm text-slate-700">
          <strong className="text-slate-900">Why use this?</strong> Writing down your reasons helps you avoid emotional decisions. When you set a review date, the system reminds you to check if your reasons still hold.
        </p>
      </div>

      {triggerPageAction && theses.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" className="text-sm text-primary-600 hover:text-primary-700 underline" onClick={() => { trackAction('link-liquidation', 'Engines & Tools'); triggerPageAction('Engines & Tools', 'openLiquidation'); }}>
            See sell priority list
          </button>
          <button type="button" className="text-sm text-primary-600 hover:text-primary-700 underline" onClick={() => { trackAction('link-risk-trading', 'Engines & Tools'); triggerPageAction('Investments', 'openRiskTradingHub'); }}>
            Safety & rules
          </button>
        </div>
      )}

      <SectionCard title="Add an investment idea" infoHint="Write why you bought it, when to check back, and what would change your mind. Helps you stay disciplined." collapsible collapsibleSummary="Symbol, thesis, review date" defaultExpanded>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Stock or fund symbol</label>
              <input className="input-base w-full" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. AAPL" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">When to review</label>
              <input className="input-base w-full" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} title="Set a date to check if your reasons still hold" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Why did you buy this?</label>
            <textarea className="input-base w-full min-h-[90px]" value={buyThesis} onChange={(e) => setBuyThesis(e.target.value)} placeholder="e.g. Strong growth, good dividend, believe in the company long-term. What made it a good idea for you?" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Expected growth % (optional)</label>
              <input className="input-base w-full" value={expectedUpsidePct} onChange={(e) => setExpectedUpsidePct(e.target.value)} placeholder="e.g. 25" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Time horizon (optional)</label>
              <input className="input-base w-full" value={expectedTimeline} onChange={(e) => setExpectedTimeline(e.target.value)} placeholder="e.g. 12–18 months" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">What could go wrong? (optional)</label>
            <textarea className="input-base w-full min-h-[70px]" value={keyRisks} onChange={(e) => setKeyRisks(e.target.value)} placeholder="Risks you're aware of" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Key dates (optional)</label>
              <input className="input-base w-full" value={catalystDates} onChange={(e) => setCatalystDates(e.target.value)} placeholder="Earnings, product launch, etc." />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">When would you change your mind? (optional)</label>
              <input className="input-base w-full" value={invalidationPoint} onChange={(e) => setInvalidationPoint(e.target.value)} placeholder="e.g. If price drops below X, or company misses target" />
            </div>
          </div>

          <button type="button" className="btn-primary" onClick={addThesis}>
            Save idea
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Quick note" collapsible collapsibleSummary="Quick note">
        <p className="text-sm text-slate-600 mb-2">Jot down a decision, reminder, or life event—anything you want to remember.</p>
        <input
          className="input-base w-full mb-2"
          placeholder="Title (e.g. Sold AAPL, bought house)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="input-base w-full min-h-[100px]"
          placeholder="Your note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="button" className="btn-primary mt-2" onClick={add}>
          Save note
        </button>
      </SectionCard>

      <SectionCard title="Your saved ideas" className="mt-6" collapsible collapsibleSummary={`${theses.length} ideas saved`} defaultExpanded>
        {theses.length === 0 ? (
          <p className="text-sm text-slate-500">No ideas saved yet. Add one above to get started.</p>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-600 mb-3">When you sell a holding, record how it went so you can learn from it.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Which one did you sell?</label>
                  <select className="input-base w-full" value={outcomeSymbol} onChange={(e) => setOutcomeSymbol(e.target.value)}>
                    {theses.map((t) => (
                      <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Actual return %</label>
                  <input className="input-base w-full" value={actualReturnPct} onChange={(e) => setActualReturnPct(e.target.value)} placeholder="e.g. 12.5" />
                </div>
                <div>
                  <button type="button" className="btn-primary w-full mt-5" onClick={recordOutcomeWithTracking}>
                    Save outcome
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">What did you learn?</label>
                <textarea className="input-base w-full min-h-[70px]" value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="What went right or wrong? Would you do it again?" />
              </div>
            </div>

            <ul className="space-y-3">
              {theses.map((t) => {
                const validity = thesisValidityCheck(t);
                return (
                  <li key={t.symbol} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs text-slate-400">Created: {new Date(t.createdAt).toLocaleDateString()}</p>
                        <p className="font-semibold text-slate-900">{t.symbol}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold ${validity.valid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {validity.valid ? 'On track' : 'Time to review'}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{t.buyThesis}</p>
                    <div className="mt-3 text-sm text-slate-600 space-y-1">
                      {t.expectedUpsidePct != null && <div>Expected growth: {t.expectedUpsidePct}%</div>}
                      {t.expectedTimeline && <div>Time horizon: {t.expectedTimeline}</div>}
                      {t.keyRisks && <div>Risks: {t.keyRisks}</div>}
                      {t.catalystDates && <div>Key dates: {t.catalystDates}</div>}
                      {t.invalidationPoint && <div>Change mind if: {t.invalidationPoint}</div>}
                      {t.reviewDate && <div>Review by: {new Date(t.reviewDate).toLocaleDateString()}</div>}
                      {t.postResultReflection && (
                        <div className="pt-2 border-t border-slate-200">
                          <div className="text-xs font-semibold text-slate-500">What I learned</div>
                          <div className="whitespace-pre-wrap mt-1">{t.postResultReflection}</div>
                        </div>
                      )}
                    </div>
                    {!validity.valid && <p className="text-xs text-amber-700 mt-2">{validity.reason}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </SectionCard>
      <SectionCard title="Note history" className="mt-6" collapsible collapsibleSummary="Journal notes">
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-500">No notes yet.</p>
        ) : (
          <ul className="space-y-4">
            {sorted.map((e) => (
              <li key={e.id} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                <p className="text-xs text-slate-400">{new Date(e.at).toLocaleString()}</p>
                <p className="font-semibold text-slate-900">{e.title}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{e.body}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </PageLayout>
  );
};

export default FinancialJournal;

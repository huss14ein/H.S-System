import React, { useState, useEffect, useMemo } from 'react';
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

const FinancialJournal: React.FC<{ setActivePage?: (p: Page) => void }> = () => {
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

  const add = () => {
    if (!title.trim() && !body.trim()) return;
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
    <PageLayout title="Financial journal" description="Private notes on this device—investment thesis, decisions, and reminders.">
      <SectionCard title="Thesis tracker">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Symbol</label>
              <input className="input-base w-full" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. AAPL" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Review date</label>
              <input className="input-base w-full" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Buy thesis</label>
            <textarea className="input-base w-full min-h-[90px]" value={buyThesis} onChange={(e) => setBuyThesis(e.target.value)} placeholder="Expected upside, timeline, why now, what would change your mind…" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Expected upside % (optional)</label>
              <input className="input-base w-full" value={expectedUpsidePct} onChange={(e) => setExpectedUpsidePct(e.target.value)} placeholder="e.g. 25" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Expected timeline (optional)</label>
              <input className="input-base w-full" value={expectedTimeline} onChange={(e) => setExpectedTimeline(e.target.value)} placeholder="e.g. 12-18 months" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Key risks (optional)</label>
            <textarea className="input-base w-full min-h-[70px]" value={keyRisks} onChange={(e) => setKeyRisks(e.target.value)} placeholder="What can go wrong?" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Catalyst dates (optional)</label>
              <input className="input-base w-full" value={catalystDates} onChange={(e) => setCatalystDates(e.target.value)} placeholder="YYYY-MM-DD, YYYY-MM-DD…" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Invalidation point (optional)</label>
              <input className="input-base w-full" value={invalidationPoint} onChange={(e) => setInvalidationPoint(e.target.value)} placeholder="e.g. price <= X or thesis disproved" />
            </div>
          </div>

          <button type="button" className="btn-primary" onClick={addThesis}>
            Save thesis
          </button>
        </div>
      </SectionCard>

      <SectionCard title="New entry">
        <input
          className="input-base w-full mb-2"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="input-base w-full min-h-[100px]"
          placeholder="Thesis, trade rationale, life event…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="button" className="btn-primary mt-2" onClick={add}>
          Save entry
        </button>
      </SectionCard>

      <SectionCard title="Thesis review & outcomes" className="mt-6">
        {theses.length === 0 ? (
          <p className="text-sm text-slate-500">No thesis records yet.</p>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Record outcome for</label>
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
                  <button type="button" className="btn-primary w-full mt-5" onClick={recordOutcome}>
                    Record outcome
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">Reflection</label>
                <textarea className="input-base w-full min-h-[70px]" value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="What went right/wrong? Did the thesis hold? Next steps…" />
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
                        {validity.valid ? 'Thesis valid' : 'Needs review'}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{t.buyThesis}</p>
                    <div className="mt-3 text-sm text-slate-600 space-y-1">
                      {t.expectedUpsidePct != null && <div>Expected upside: {t.expectedUpsidePct}%</div>}
                      {t.expectedTimeline && <div>Timeline: {t.expectedTimeline}</div>}
                      {t.keyRisks && <div>Risks: {t.keyRisks}</div>}
                      {t.catalystDates && <div>Catalysts: {t.catalystDates}</div>}
                      {t.invalidationPoint && <div>Invalidation: {t.invalidationPoint}</div>}
                      {t.reviewDate && <div>Review date: {new Date(t.reviewDate).toLocaleDateString()}</div>}
                      {t.postResultReflection && (
                        <div className="pt-2 border-t border-slate-200">
                          <div className="text-xs font-semibold text-slate-500">Post-result reflection</div>
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
      <SectionCard title="History" className="mt-6">
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-500">No entries yet.</p>
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

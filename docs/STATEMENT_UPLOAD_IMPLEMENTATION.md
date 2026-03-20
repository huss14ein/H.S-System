# Statement Upload — implementation status

## Overview

Users upload bank statements, paste SMS transactions, or upload trading statements; parsed rows are reviewed and imported into **DataContext** (Supabase-backed transactions / trades). **Statement History** shows imports, CSV export, and reconciliation against existing ledger data.

---

## Implemented

| Area | Details |
|------|---------|
| **UI** | `pages/StatementUpload.tsx` — tabs (bank / SMS / trading), drag-and-drop, review modal, duplicate hints (`findDuplicateTransactions`), import via `addTransaction` / `recordTrade`. |
| **Parsing** | `services/statementParser.ts` — bank PDF/CSV/Excel, SMS, trading; optional Gemini. |
| **Navigation** | Routes + **Statement History** in app shell. |
| **Database** | Migration `supabase/migrations/add_financial_statements_table.sql` — `financial_statements`, `extracted_transactions`, RLS. **Apply in Supabase** if not already. |
| **StatementProcessingContext** | Loads `financial_statements` + nested `extracted_transactions`; localStorage fallback if DB unavailable. **`commitParsedStatementFromUpload`** writes UUID statement + extracted rows after a successful parse (signed-in users). Metadata upsert skips non-UUID legacy IDs. |
| **Statement History** | `pages/StatementHistoryView.tsx` — list, filters, delete (DB + state), CSV export, **reconcile** vs `data.transactions`. |
| **Reconciliation** | `reconcileTransactions(statementId)` — date/amount/description matching + optional AI suggestions; works on statements that have extracted rows in context (including post-upload). |
| **Original file in Storage** | After DB insert, the app uploads the file to bucket **`financial-statements`** (≤50 MiB) when Storage is configured. **Statement History** → **Original file** uses a signed URL. |

---

## Optional / not shipped

| Item | Status |
|------|--------|
| **File blob storage** | **Implemented** when you run `add_financial_statements_storage.sql` + create the bucket/policies (`docs/supabase_storage_financial_statements.md`). If Storage is missing, upload is skipped and imports still work. |
| **Context “simulate processing” path** | `uploadStatement` / `processStatement` still contain demo delays + mock PDF rows for legacy/testing; **Statement Upload** uses the real parser + **`commitParsedStatementFromUpload`** only. |

---

## Integration checklist

- [x] UI component created  
- [x] Parser service implemented  
- [x] Navigation added  
- [x] Transaction saving to DataContext  
- [x] Database tables defined (run migration on your project)  
- [x] StatementProcessingContext integrated with Supabase (metadata + extracted rows on commit)  
- [x] Statement history view  
- [x] Reconciliation with existing transactions (heuristic + AI assist)  
- [x] File storage integration (optional) — **implemented** via Supabase Storage + migration `add_financial_statements_storage.sql` + setup doc `supabase_storage_financial_statements.md`.  

---

## Operator notes

1. Run `add_financial_statements_table.sql` in Supabase SQL editor (or your migration pipeline).  
2. Without Supabase auth/session, history still works via **localStorage**; DB sync applies when the user is signed in.  
3. Trading imports map each line to `extracted_transactions` (debit/credit by trade type) for history and reconciliation.

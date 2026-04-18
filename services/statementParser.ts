import { Transaction, InvestmentTransaction } from '../types';
import { invokeAI } from './geminiService';
import { capitalizeCategoryName } from '../utils/categoryFormat';

export interface ParseResult {
  transactions: Transaction[];
  investmentTransactions?: InvestmentTransaction[];
  confidence: number;
  errors?: string[];
  warnings?: string[];
  validation?: ValidationResult;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  statistics: {
    totalTransactions: number;
    validTransactions: number;
    invalidTransactions: number;
    duplicateCount: number;
    dateRange: { start: string; end: string } | null;
    amountRange: { min: number; max: number; total: number } | null;
  };
}

export interface TradingParseDebug {
  fileType: string;
  extractedTextLength: number;
  parserMatches: {
    awaedTable: number;
    structured: number;
    tokenStream: number;
    globalPattern: number;
    heuristic: number;
    ai: number;
    totalDeduped: number;
  };
  sampleText: string;
}

/**
 * Parse bank statement from uploaded file
 */
export async function parseBankStatement(
  file: File,
  accountId: string
): Promise<ParseResult> {
  try {
    const fileType = await detectFileType(file);
    let text = '';
    
    if (fileType === 'pdf') {
      text = await extractTextFromPDF(file);
    } else if (fileType === 'csv') {
      text = await parseCSV(file);
    } else if (fileType === 'ofx' || fileType === 'qfx' || fileType === 'txt') {
      // OFX/QFX/TXT are text-based; parse as text and let extractor normalize rows.
      text = await parseCSV(file);
    } else if (fileType === 'xlsx' || fileType === 'xls') {
      text = await parseExcel(file);
    } else {
      throw new Error(`Unsupported file type: ${fileType}. Please upload PDF, CSV, Excel, OFX, QFX, or TXT statement files.`);
    }

    // Use AI to extract transactions from text
    const transactions = await extractTransactionsFromText(text, accountId, 'bank');
    
    // Validate extracted transactions
    const validation = validateTransactions(transactions);
    
    return {
      transactions: validation.isValid ? transactions : transactions.filter((_, i) => {
        // Filter out invalid transactions
        const txDate = new Date(transactions[i].date);
        return !isNaN(txDate.getTime()) && transactions[i].description && transactions[i].amount !== undefined;
      }),
      confidence: validation.isValid ? 0.85 : Math.max(0, 0.85 - (validation.errors.length * 0.1)),
      errors: validation.errors,
      warnings: validation.warnings,
      validation
    };
  } catch (error) {
    console.error('Error parsing bank statement:', error);
    return {
      transactions: [],
      confidence: 0,
      errors: [error instanceof Error ? error.message : 'Failed to parse statement']
    };
  }
}

/**
 * Parse SMS transaction text
 */
export async function parseSMSTransactions(
  smsText: string,
  accountId: string
): Promise<ParseResult> {
  try {
    const normalizedSmsText = normalizeSmsTextForParsing(smsText);
    // First try pattern-based extraction for common SMS formats
    const patternTransactions = extractTransactionsFromSMS(normalizedSmsText, accountId);
    const heuristicTransactions = extractTransactionsFromSMSHeuristic(normalizedSmsText, accountId);
    let aiTimedOut = false;

    // Then use AI to extract any additional transactions, but cap wait time to keep SMS import responsive.
    const aiController = new AbortController();
    const aiTimeoutId = setTimeout(() => {
      aiTimedOut = true;
      aiController.abort();
    }, 4000);
    let aiTransactions: Transaction[] = [];
    try {
      aiTransactions = await extractTransactionsFromText(normalizedSmsText, accountId, 'sms', aiController.signal);
    } catch (error) {
      const abortErr = error as { name?: string };
      if (abortErr && abortErr.name === 'AbortError') {
        // timed out — pattern/heuristic results still apply
      } else {
        console.warn('SMS AI extraction failed; using pattern/heuristic SMS parsing only:', error);
      }
    } finally {
      clearTimeout(aiTimeoutId);
    }
    
    // Merge and deduplicate
    const allTransactions = normalizeTransactionsDateConvention([
      ...patternTransactions,
      ...heuristicTransactions,
      ...aiTransactions,
    ]);
    const uniqueTransactions = deduplicateTransactions(allTransactions);
    
    // Validate extracted transactions
    const validation = validateTransactions(uniqueTransactions);
    
    return {
      transactions: validation.isValid ? uniqueTransactions : uniqueTransactions.filter((_, i) => {
        const txDate = new Date(uniqueTransactions[i].date);
        return !isNaN(txDate.getTime()) && uniqueTransactions[i].description && uniqueTransactions[i].amount !== undefined;
      }),
      confidence: validation.isValid ? 0.90 : Math.max(0, 0.90 - (validation.errors.length * 0.1)),
      errors: validation.errors,
      warnings: aiTimedOut
        ? [...(validation.warnings ?? []), 'AI extraction timed out after 4s; parsed pattern/heuristic SMS results only.']
        : validation.warnings,
      validation
    };
  } catch (error) {
    console.error('Error parsing SMS:', error);
    return {
      transactions: [],
      confidence: 0,
      errors: [error instanceof Error ? error.message : 'Failed to parse SMS']
    };
  }
}

/**
 * Parse trading statement
 */
export async function parseTradingStatement(
  file: File,
  accountId: string
): Promise<{ transactions: InvestmentTransaction[]; confidence: number; errors?: string[]; warnings?: string[]; validation?: ValidationResult; debug?: TradingParseDebug }> {
  try {
    const fileType = await detectFileType(file);
    let text = '';
    
    if (fileType === 'pdf') {
      text = await extractTextFromPDF(file);
    } else if (fileType === 'csv') {
      text = await parseCSV(file);
    } else if (fileType === 'ofx' || fileType === 'qfx' || fileType === 'txt') {
      text = await parseCSV(file);
    } else if (fileType === 'xlsx' || fileType === 'xls') {
      text = await parseExcel(file);
    } else {
      throw new Error(`Unsupported file type: ${fileType}. Please upload PDF, CSV, Excel, OFX, QFX, or TXT statement files.`);
    }

    const statementCurrency = inferStatementCurrency(text);
    const structuredWarnings: string[] = [];
    const parsedFromAwaedTable = extractInvestmentTransactionsFromAwaedTable(text, accountId || '', {
      statementCurrency,
      warnings: structuredWarnings,
    });
    // First pass: deterministic parser for broker statement table rows.
    const parsedFromRows = extractInvestmentTransactionsFromStructuredText(text, accountId || '', {
      statementCurrency,
      warnings: structuredWarnings,
    });
    // 1.5 pass: token-stream parser for flattened PDF extraction where line breaks are missing.
    const parsedFromTokenStream = extractInvestmentTransactionsFromTokenStream(text, accountId || '', {
      statementCurrency,
      warnings: structuredWarnings,
    });
    const parsedFromGlobalPattern = extractInvestmentTransactionsFromGlobalPattern(text, accountId || '', {
      statementCurrency,
      warnings: structuredWarnings,
    });
    // Second pass: AI extraction as fallback/enrichment.
    const heuristicRows = extractInvestmentTransactionsFromHeuristicText(text, accountId || '', {
      statementCurrency,
      warnings: structuredWarnings,
    });
    const aiTransactions = await extractInvestmentTransactionsFromText(text, accountId || '');
    const transactions = dedupeInvestmentTransactions([
      ...parsedFromAwaedTable,
      ...parsedFromRows,
      ...parsedFromTokenStream,
      ...parsedFromGlobalPattern,
      ...heuristicRows,
      ...aiTransactions,
    ]);
    const debug: TradingParseDebug = {
      fileType,
      extractedTextLength: text.length,
      parserMatches: {
        structured: parsedFromRows.length,
        tokenStream: parsedFromTokenStream.length,
        globalPattern: parsedFromGlobalPattern.length,
        awaedTable: parsedFromAwaedTable.length,
        heuristic: heuristicRows.length,
        ai: aiTransactions.length,
        totalDeduped: transactions.length,
      },
      sampleText: text.replace(/\s+/g, ' ').trim().slice(0, 320),
    };
    
    // Validate extracted transactions
    const validation = validateTransactions([], transactions);
    
    return {
      transactions: validation.isValid ? transactions : transactions.filter((_, i) => {
        const txDate = new Date(transactions[i].date);
        return !isNaN(txDate.getTime()) && transactions[i].symbol && 
               transactions[i].quantity !== undefined && transactions[i].price !== undefined;
      }),
      confidence: validation.isValid
        ? (parsedFromAwaedTable.length > 0 || parsedFromRows.length > 0 || parsedFromTokenStream.length > 0 || parsedFromGlobalPattern.length > 0 || heuristicRows.length > 0 ? 0.92 : 0.80)
        : Math.max(0, 0.80 - (validation.errors.length * 0.1)),
      errors: validation.errors,
      warnings: [
        ...(validation.warnings ?? []),
        ...structuredWarnings,
        ...(transactions.length === 0 ? ['No investment transactions were recognized. If this is a text statement, ensure each row includes date, type, symbol, quantity, and price/amount.'] : []),
      ],
      validation,
      debug,
    };
  } catch (error) {
    console.error('Error parsing trading statement:', error);
    return {
      transactions: [],
      confidence: 0,
      errors: [error instanceof Error ? error.message : 'Failed to parse trading statement']
    };
  }
}

/**
 * Extract text from PDF using browser APIs or fallback
 */
async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const direct = await file.text();
    // If direct text looks like binary, use byte-stream extraction.
    if (direct && /[A-Za-z]{3,}/.test(direct) && !/[\u0000-\u0008]/.test(direct)) return direct;
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const extracted = extractLikelyTextFromPdfBytes(bytes);
    if (extracted.trim().length >= 64) return extracted;
    const aiText = await extractTextFromPDFWithAI(bytes, file.type || 'application/pdf');
    return aiText.trim() || extracted;
  } catch (error) {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const extracted = extractLikelyTextFromPdfBytes(bytes);
    if (extracted.trim().length >= 64) return extracted;
    const aiText = await extractTextFromPDFWithAI(bytes, file.type || 'application/pdf');
    return aiText.trim() || extracted;
  }
}

/**
 * Extract text from PDF using AI (fallback)
 */
async function extractTextFromPDFWithAI(bytes: Uint8Array, mimeType: string): Promise<string> {
  try {
    const base64 = bytesToBase64(bytes);
    const prompt = [
      'Extract readable text from this PDF statement for downstream parser ingestion.',
      'Return plain text only.',
      'Preserve transaction-like row ordering whenever possible.',
      'Do not summarize. Do not add commentary.',
    ].join(' ');
    const response = await invokeAI({
      model: 'gemini-3-flash-preview',
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType || 'application/pdf', data: base64 } },
        ],
      }],
    });
    const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text || response?.text || '';
    return String(responseText || '').trim();
  } catch (error) {
    console.warn('AI PDF text extraction fallback failed:', error);
    return '';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Parse CSV file
 */
async function parseCSV(file: File): Promise<string> {
  const text = await file.text();
  return text;
}

/**
 * Parse Excel file
 */
async function parseExcel(file: File): Promise<string> {
  // For Excel files, we'd need a library like xlsx
  // For now, try to read as text (won't work well)
  // In production, use a library or convert to CSV first
  try {
    const text = await file.text();
    return text;
  } catch {
    // Fallback: use AI to extract
    return '';
  }
}

/**
 * Extract transactions from SMS text using patterns
 */
function extractTransactionsFromSMS(smsText: string, accountId: string): Transaction[] {
  const transactions: Transaction[] = [];
  const lines = smsText.split('\n').filter(line => line.trim());
  
  // Common SMS patterns for KSA banks
  const patterns = [
    // Al Rajhi Bank pattern
    /(?:Al Rajhi|الراجحي)[:\s]+SAR\s+([\d,]+\.?\d*)\s+(?:debited|credited|withdrawn|deposited|paid|received)\s+from\s+(?:A\/C|Account)\s*\*?(\d+)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    // STC pattern
    /STC[:\s]+(?:Payment|Transaction)\s+of\s+SAR\s+([\d,]+\.?\d*)\s+(?:received|paid|debited)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    // Generic pattern
    /([A-Za-z\s]+)[:\s]+SAR\s+([\d,]+\.?\d*)\s+(?:debited|credited|withdrawn|deposited|paid|received|purchase|payment)\s+(?:from|to|on|at)\s+([^\n]+)/i,
    // Date-first pattern
    /(\d{1,2}\/\d{1,2}\/\d{2,4})[:\s]+([A-Za-z\s]+)[:\s]+SAR\s+([\d,]+\.?\d*)/i,
  ];
  
  for (const line of lines) {
    if (/(balance|رصيد)/i.test(line) && !/(amount|مبلغ|debited|credited|paid|received|purchase|withdrawn|deposited|خصم|شراء|دفع|استلام|إيداع)/i.test(line)) {
      continue;
    }
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        let amount = 0;
        let description = '';
        let dateStr = '';
        let isDebit = false;
        
        // Extract based on pattern
        if (pattern.source.includes('Al Rajhi')) {
          amount = parseFloat(match[1].replace(/,/g, ''));
          dateStr = match[3];
          description = line.substring(0, line.indexOf('SAR')).trim();
          isDebit = /debited|withdrawn|paid/i.test(line);
        } else if (pattern.source.includes('STC')) {
          amount = parseFloat(match[1].replace(/,/g, ''));
          dateStr = match[2];
          description = 'STC Payment';
          isDebit = /paid|debited/i.test(line);
        } else if (pattern.source.includes('Date-first')) {
          dateStr = match[1];
          description = match[2].trim();
          amount = parseFloat(match[3].replace(/,/g, ''));
          isDebit = /debited|withdrawn|paid|purchase/i.test(line);
        } else {
          // Generic pattern
          description = match[1]?.trim() || '';
          amount = parseFloat(match[2]?.replace(/,/g, '') || '0');
          isDebit = /debited|withdrawn|paid|purchase/i.test(line);
          
          // Try to extract date from the rest
          const dateMatch = match[3]?.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
          if (dateMatch) {
            dateStr = dateMatch[1];
          }
        }
        
        if (amount > 0 && description && !/(balance|رصيد)/i.test(description)) {
          const canonicalDescription = canonicalizeTransactionDescription(description);
          let date = parseDate(dateStr || formatLocalYmd(new Date()));
          if (Number.isNaN(date.getTime())) date = new Date();
          const category = inferCategory(canonicalDescription);
          
          transactions.push({
            id: `sms-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date: formatLocalYmd(date),
            description: canonicalDescription,
            amount: isDebit ? -Math.abs(amount) : Math.abs(amount),
            category,
            accountId,
            type: isDebit ? 'expense' : 'income',
            status: 'Approved'
          });
        }
        break; // Found a match, move to next line
      }
    }
  }
  
  return transactions;
}

/** Fallback parser for multiline/mixed-language SMS blocks. */
function extractTransactionsFromSMSHeuristic(smsText: string, accountId: string): Transaction[] {
  const blocks = splitSmsIntoBlocks(smsText);
  const out: Transaction[] = [];

  blocks.forEach((block, idx) => {
    const amount = extractSmsAmount(block);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const dateMatch = block.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})/);
    let parsedDate = parseDate(String(dateMatch?.[1] ?? '').replace(/\./g, '/'));
    if (Number.isNaN(parsedDate.getTime())) {
      const fb = extractFirstSmsDateInBlock(block).replace(/\./g, '/');
      parsedDate = fb ? parseDate(fb) : parsedDate;
    }
    const dateIso = formatLocalYmd(Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate);

    const explicitDesc =
      block.match(/(?:لدى|merchant|at|from)\s*[:\-]?\s*([A-Za-z0-9&\-. ]{2,})/i)?.[1]?.trim() ??
      block
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /[A-Za-z]{3,}/.test(line) && !/SAR|balance|رصيد|مبلغ/i.test(line));
    const description = canonicalizeTransactionDescription((explicitDesc || `SMS Transaction ${idx + 1}`).slice(0, 120).trim());

    const isDebit = /debited|withdrawn|purchase|payment|paid|شراء|سحب|خصم|دفع|نقاط البيع/i.test(block);
    const signed = isDebit ? -Math.abs(amount) : Math.abs(amount);
    const category = inferCategory(description);

    out.push({
      id: `sms-heur-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
      date: dateIso,
      description,
      amount: signed,
      category,
      accountId,
      type: signed < 0 ? 'expense' : 'income',
      status: 'Approved',
    });
  });

  // Second pass: line-window extraction for tightly packed multi-SMS text.
  const dateRe = /\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/;
  const lines = smsText.split('\n').map((l) => l.trim()).filter(Boolean);
  const signatures = new Set(out.map((t) => `${t.date}|${t.amount}|${t.description.toLowerCase()}`));
  for (let i = 0; i < lines.length; i++) {
    if (!dateRe.test(lines[i])) continue;
    const window = [lines[i], lines[i - 1], lines[i - 2], lines[i + 1]].filter(Boolean).join('\n');
    const amount = extractSmsAmount(window);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    let parsedDate = parseDate(lines[i].replace(/\./g, '/'));
    if (Number.isNaN(parsedDate.getTime())) parsedDate = parseDate(extractFirstSmsDateInBlock(window).replace(/\./g, '/'));
    const dateIso = formatLocalYmd(Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate);
    const descLine =
      [lines[i - 1], lines[i - 2], lines[i + 1]]
        .filter(Boolean)
        .find((line) => /[A-Za-z]{3,}/.test(line) && !/SAR|balance|رصيد|مبلغ/i.test(line)) ?? `SMS Transaction ${i + 1}`;
    const isDebit = /debited|withdrawn|purchase|payment|paid|شراء|سحب|خصم|دفع|نقاط البيع/i.test(window);
    const signed = isDebit ? -Math.abs(amount) : Math.abs(amount);
    const description = canonicalizeTransactionDescription(descLine.slice(0, 120).trim());
    const sig = `${dateIso}|${signed}|${description.toLowerCase()}`;
    if (signatures.has(sig)) continue;
    signatures.add(sig);
    out.push({
      id: `sms-heur-line-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
      date: dateIso,
      description,
      amount: signed,
      category: inferCategory(description),
      accountId,
      type: signed < 0 ? 'expense' : 'income',
      status: 'Approved',
    });
  }

  // Third pass: date-anchored extraction for compact pastes where multiple SMS were copied in one paragraph.
  const anchored = extractTransactionsFromSmsDateAnchors(smsText, accountId);
  for (const tx of anchored) {
    const sig = `${tx.date}|${tx.amount}|${tx.description.toLowerCase()}`;
    if (signatures.has(sig)) continue;
    signatures.add(sig);
    out.push(tx);
  }

  // Fourth pass: currency-token anchors (handles NBSP-heavy bank SMS and ISO dates without slashes).
  const currencyAnchored = extractTransactionsFromSmsCurrencyAnchors(smsText, accountId);
  for (const tx of currencyAnchored) {
    const sig = `${tx.date}|${tx.amount}|${tx.description.toLowerCase()}`;
    if (signatures.has(sig)) continue;
    signatures.add(sig);
    out.push(tx);
  }

  return out;
}

/** Split raw SMS paste into transaction-like blocks (blank lines OR starter lines). */
function splitSmsIntoBlocks(smsText: string): string[] {
  const byBlank = smsText
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;

  const lines = smsText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return lines;
  const blocks: string[] = [];
  let current: string[] = [];
  const startRe =
    /(purchase|payment|transaction|debited|credited|withdrawn|received|transfer|paid|spent|pos|atm|شراء|سحب|خصم|نقاط البيع|تحويل|سداد|عملية|إيداع|ايداع|استلام)/i;
  const dateRe = /\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/;

  for (const line of lines) {
    const startsNew = startRe.test(line) && current.length > 0;
    if (startsNew) {
      blocks.push(current.join('\n').trim());
      current = [line];
      continue;
    }
    current.push(line);
    if (dateRe.test(line) && current.length >= 3) {
      blocks.push(current.join('\n').trim());
      current = [];
    }
  }
  if (current.length) blocks.push(current.join('\n').trim());
  return blocks.filter(Boolean);
}

function extractSmsAmount(block: string): number {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const parseNum = (raw: string | undefined) => Number((raw ?? '0').replace(/,/g, ''));
  const compact = String(block || '').replace(/\s+/g, ' ').trim();

  /** KSA SMS often uses "SR" (not SAR) and Arabic "بـSR 57.5" on purchase lines (e.g. STC Yaqoot). */
  const arabPurchaseSr =
    compact.match(/شراء[\s\S]{0,500}?\bبـ\s*SR\s*([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|[\d]+(?:\.\d+)?)\b/i) ??
    compact.match(/شراء[\s\S]{0,300}?\bSR\s*([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|[\d]+(?:\.\d+)?)\b/i);
  if (arabPurchaseSr) {
    const n = parseNum(arabPurchaseSr[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const moneyAfterCurrency =
    /(?:SAR|SR|USD|EUR|\$|ر\.?س|ريال)[^\d]{0,20}([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|[\d]+(?:\.\d+)?)/i;
  const moneyBeforeCurrency =
    /([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|[\d]+(?:\.\d+)?)\s*(?:SAR|SR|USD|EUR|\$|ر\.?س|ريال)\b/i;
  const kdPattern = /([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|[\d]+(?:\.\d+)?)\s*(?:KD|KWD|د\.ك)\b/i;

  const withAmountLabel = lines.find((line) => /(amount|مبلغ)/i.test(line));
  const labelMatch = withAmountLabel?.match(moneyAfterCurrency)
    ?? withAmountLabel?.match(moneyBeforeCurrency)
    ?? withAmountLabel?.match(kdPattern);
  if (labelMatch) return parseNum(labelMatch[1]);

  const explicitAmt = block.match(/\b(?:amount|مبلغ)\s*[:\-]?\s*([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|[\d]+(?:\.\d+)?)\b/i);
  if (explicitAmt) {
    const n = parseNum(explicitAmt[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const nonBalance = lines.filter((line) => {
    if (/(?:^|\s)(?:balance|رصيد)\s*:/i.test(line) && !/(amount|مبلغ|شراء|purchase)/i.test(line)) return false;
    return true;
  });
  for (const line of nonBalance) {
    if (/(?:^|\s)(?:balance|رصيد)\s*:/i.test(line) && !/(amount|مبلغ|شراء)/i.test(line)) continue;
    const m = line.match(moneyAfterCurrency)
      ?? line.match(moneyBeforeCurrency)
      ?? line.match(kdPattern);
    if (m) return parseNum(m[1]);
  }

  const anyMatch = block.match(moneyAfterCurrency)
    ?? block.match(moneyBeforeCurrency)
    ?? block.match(kdPattern);
  return parseNum(anyMatch?.[1]);
}

function extractSmsNearestDateBefore(text: string, pos: number): string {
  const slice = text.slice(Math.max(0, pos - 280), pos);
  const isoMatches = [...slice.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)];
  if (isoMatches.length) return isoMatches[isoMatches.length - 1][1];
  const slashMatches = [...slice.matchAll(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})\b/g)];
  if (slashMatches.length) return slashMatches[slashMatches.length - 1][1].replace(/\./g, '/');
  return '';
}

/** When date regex missed (e.g. dotted 08.04.2026), still find a date in the block for heuristics. */
function extractFirstSmsDateInBlock(block: string): string {
  const iso = block.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const slash = block.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})\b/);
  return slash ? slash[1].replace(/\./g, '/') : '';
}

function extractTransactionsFromSmsDateAnchors(smsText: string, accountId: string): Transaction[] {
  const results: Transaction[] = [];
  const dateAnchors = [
    ...smsText.matchAll(/(?:(\d{1,2}:\d{2})\s*)?(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})/g),
  ];
  if (!dateAnchors.length) return results;
  for (let i = 0; i < dateAnchors.length; i++) {
    const current = dateAnchors[i];
    const start = Math.max(0, (current.index ?? 0) - 220);
    const end = i + 1 < dateAnchors.length ? (dateAnchors[i + 1].index ?? smsText.length) : Math.min(smsText.length, (current.index ?? 0) + 220);
    const segment = smsText.slice(start, end);
    const amount = extractSmsAmount(segment);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const rawDate = String(current[2] || '').replace(/\./g, '/');
    const parsedDate = parseDate(rawDate);
    const dateIso = formatLocalYmd(Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate);
    const description = canonicalizeTransactionDescription(extractSmsDescription(segment, i));
    const isDebit = /(debited|withdrawn|purchase|payment|paid|spent|شراء|سحب|خصم|دفع|نقاط البيع|شراء عبر)/i.test(segment);
    const signed = isDebit ? -Math.abs(amount) : Math.abs(amount);
    results.push({
      id: `sms-anchor-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
      date: dateIso,
      description,
      amount: signed,
      category: inferCategory(description),
      accountId,
      type: signed < 0 ? 'expense' : 'income',
      status: 'Approved',
    });
  }
  return results;
}

/**
 * Currency-adjacent amounts (many banks use "SAR\u00a0500.00" or "500.00 SAR") when slash dates are absent.
 */
function extractTransactionsFromSmsCurrencyAnchors(smsText: string, accountId: string): Transaction[] {
  const results: Transaction[] = [];
  const seen = new Set<string>();
  /** Currency before amount, amount before currency, or USD with $ */
  const pairRe =
    /\b(?:SAR|SR|USD|EUR|ريال|ر\.س)\s*[:\u00A0]?\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{1,4})?|[\d]+(?:\.\d{1,4})?)|\b([\d]{1,3}(?:,\d{3})*(?:\.\d{1,4})?|[\d]+(?:\.\d{1,4})?)\s*(?:SAR|SR|USD|EUR|ريال|ر\.س)\b|\$\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{1,4})?|[\d]+(?:\.\d{1,4})?)/gi;

  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = pairRe.exec(smsText)) !== null) {
    const rawAmt = String(m[1] || m[2] || m[3] || '').replace(/,/g, '');
    const amount = Number(rawAmt);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      idx++;
      continue;
    }

    const at = m.index ?? 0;
    const windowStart = Math.max(0, at - 260);
    const windowEnd = Math.min(smsText.length, at + 140);
    const segment = smsText.slice(windowStart, windowEnd);

    const looksLikeBalanceOnly =
      /\b(balance|رصيد)\b/i.test(segment) &&
      !/\b(amount|مبلغ|debited|credited|withdrawn|purchase|paid|spent|transfer|شراء|سحب|خصم|عملية)\b/i.test(segment) &&
      !/\b(?:POS|ATM|purchase|payment)\b/i.test(segment);
    if (looksLikeBalanceOnly) {
      idx++;
      continue;
    }

    let dateRaw = extractSmsNearestDateBefore(smsText, at);
    if (!dateRaw) dateRaw = extractFirstSmsDateInBlock(segment);
    const parsedDate = parseDate(dateRaw);
    const dateIso = formatLocalYmd(Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate);

    const description = canonicalizeTransactionDescription(extractSmsDescription(segment, idx));
    const isDebit =
      /(debited|withdrawn|purchase|payment|paid|spent|pos|atm|transfer\s*out|شراء|سحب|خصم|دفع|نقاط البيع|شراء عبر|محفظة|سداد)/i.test(segment);
    const signed = isDebit ? -Math.abs(amount) : Math.abs(amount);
    const sig = `${dateIso}|${signed}|${description.toLowerCase()}|${at}`;
    if (seen.has(sig)) {
      idx++;
      continue;
    }
    seen.add(sig);

    results.push({
      id: `sms-ccy-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
      date: dateIso,
      description,
      amount: signed,
      category: inferCategory(description),
      accountId,
      type: signed < 0 ? 'expense' : 'income',
      status: 'Approved',
    });
    idx++;
  }

  return results;
}

function extractSmsDescription(segment: string, idx: number): string {
  const lineBased = segment
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        /[A-Za-z\u0600-\u06FF]{3,}/.test(line) &&
        !/^\s*رصيد\s*:/i.test(line) &&
        !/balance|رصيد|مبلغ|amount|^\d{1,2}:\d{2}/i.test(line),
    );
  if (lineBased) return lineBased.slice(0, 120);
  const merchantMatch =
    segment.match(/(?:merchant|at|from|لدى|لـ)\s*[:\-]?\s*([A-Za-z0-9\u0600-\u06FF&\-. ]{2,80})/i)?.[1]?.trim() ??
    segment.match(/(?:purchase|payment|transaction|عملية)\s*(?:at|لدى)?\s*[:\-]?\s*([A-Za-z0-9\u0600-\u06FF&\-. ]{2,80})/i)?.[1]?.trim();
  const purchaseLine = segment
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /شراء/i.test(l) && /(?:SR|SAR|بـ\s*SR|ريال)/i.test(l));
  const arabPurchaseTitle = purchaseLine?.replace(/\s*بـ\s*SR.*$/i, '').replace(/\s+SR.*$/i, '').trim();
  return (merchantMatch || arabPurchaseTitle || `SMS Transaction ${idx + 1}`).slice(0, 120);
}

function normalizeArabicIndicDigits(input: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  return String(input || '')
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabicIndic.indexOf(d)));
}

function normalizeSmsTextForParsing(smsText: string): string {
  const normalizedDigits = normalizeArabicIndicDigits(smsText);
  return normalizedDigits
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/(?:\.\s+|;\s+|،\s+)(?=(?:\d{1,2}:\d{2}\s*)?(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})\b)/g, '\n')
    .replace(/([^\n])\s+(?=(?:شراء|سحب|خصم|دفع|إيداع|ايداع|لـ|payment|purchase|transaction|debited|credited|withdrawn|received)\b)/gi, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Extract transactions from text using AI
 */
async function extractTransactionsFromText(
  text: string,
  accountId: string,
  source: 'bank' | 'sms',
  signal?: AbortSignal
): Promise<Transaction[]> {
  if (!text.trim()) {
    return [];
  }

  try {
    const prompt = `Extract all financial transactions from the following ${source === 'sms' ? 'SMS messages' : 'bank statement text'}.
    
Text:
${text.substring(0, 10000)} ${text.length > 10000 ? '... (truncated)' : ''}

For each transaction, extract:
- Date (format: YYYY-MM-DD)
- Description (merchant name or transaction description)
- Amount (positive for income/credit, negative for expense/debit)
- Type (income or expense)
- Category (infer from description: Food, Transportation, Housing, Utilities, Shopping, Entertainment, Health, Education, Income, etc.)

Return a JSON array of transactions in this format:
[
  {
    "date": "2024-01-15",
    "description": "STARBUCKS COFFEE",
    "amount": -25.50,
    "type": "expense",
    "category": "Food"
  },
  ...
]

Only return valid JSON, no other text.`;

    const response = await invokeAI({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      signal,
    });

    const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text || response?.text || '';
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return parsed.map((tx: any) => {
      const parsedDate = parseDate(String(tx.date || ''));
      const date = Number.isNaN(parsedDate.getTime()) ? formatLocalYmd(new Date()) : formatLocalYmd(parsedDate);
      return ({
      id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      date,
      description: tx.description || 'Unknown Transaction',
      amount: typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0,
      category: capitalizeCategoryName(tx.category || 'Uncategorized'),
      accountId,
      type: tx.type || (tx.amount < 0 ? 'expense' : 'income'),
      status: 'Approved' as const
    });
    });
  } catch (error) {
    console.error('Error extracting transactions with AI:', error);
    return [];
  }
}

/**
 * Extract investment transactions from text using AI
 */
async function extractInvestmentTransactionsFromText(
  text: string,
  accountId: string
): Promise<InvestmentTransaction[]> {
  if (!text.trim()) {
    return [];
  }

  try {
    const prompt = `Extract all investment/trading transactions from the following trading statement text.
    
Text:
${text.substring(0, 10000)} ${text.length > 10000 ? '... (truncated)' : ''}

For each transaction, extract:
- Date (format: YYYY-MM-DD)
- Type (buy, sell, dividend, deposit, withdrawal, fee, vat)
- Symbol (stock ticker symbol, e.g., AAPL, 2222.SR)
- Quantity (number of shares)
- Price (price per share)
- Total (total transaction amount)
- Currency (USD or SAR)

Return a JSON array of transactions in this format:
[
  {
    "date": "2024-01-15",
    "type": "buy",
    "symbol": "AAPL",
    "quantity": 10,
    "price": 150.00,
    "total": 1500.00,
    "currency": "USD"
  },
  ...
]

Only return valid JSON, no other text.`;

    const response = await invokeAI({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text || response?.text || '';
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return parsed.map((tx: any) => {
      const normalizedCurrency = String(tx.currency || 'SAR').toUpperCase();
      return ({
      id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      accountId,
      date: tx.date || new Date().toISOString().split('T')[0],
      type: tx.type || 'buy',
      symbol: (tx.symbol || '').toUpperCase(),
      quantity: typeof tx.quantity === 'number' ? tx.quantity : parseFloat(tx.quantity) || 0,
      price: typeof tx.price === 'number' ? tx.price : parseFloat(tx.price) || 0,
      total: typeof tx.total === 'number' ? tx.total : parseFloat(tx.total) || (tx.quantity * tx.price),
      currency: normalizedCurrency === 'USD' ? 'USD' : 'SAR'
      });
    });
  } catch (error) {
    console.error('Error extracting investment transactions with AI:', error);
    return [];
  }
}

function extractLikelyTextFromPdfBytes(bytes: Uint8Array): string {
  const latin1 = new TextDecoder('latin1').decode(bytes);
  const chunks: string[] = [];

  // Common PDF text operators: (...) Tj and [...] TJ
  const tjRegex = /\(([^()]*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRegex.exec(latin1)) !== null) {
    const txt = m[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
    if (txt.trim()) chunks.push(txt);
  }

  // Fallback: printable runs
  if (chunks.length < 10) {
    const printable = latin1.match(/[A-Za-z0-9@._\-/: ]{6,}/g) || [];
    chunks.push(...printable);
  }

  return chunks.join('\n');
}

export function extractInvestmentTransactionsFromStructuredText(
  text: string,
  accountId: string,
  opts?: { statementCurrency?: 'SAR' | 'USD'; warnings?: string[] },
): InvestmentTransaction[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: InvestmentTransaction[] = [];
  const seen = new Set<string>();
  const localWarn = new Set<string>();

  for (const line of lines) {
    if (!/^\d{2}\/\d{2}\/\d{4}/.test(line)) continue;
    const cols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 3) continue;

    const datePart = cols[0];
    const date = parseDate(datePart.split(' ')[0]);
    const dateYmd = formatLocalYmd(date);
    const description = cols.length >= 3 ? cols[2] : line;
    const trailingNumericCols = (line.match(/-?\d[\d,]*\.\d+/g) || []).map((v) => parseNumber(v)).filter((n) => Number.isFinite(n));
    const tail2 = trailingNumericCols.length >= 2 ? trailingNumericCols[trailingNumericCols.length - 2] : 0;
    const tail3 = trailingNumericCols.length >= 3 ? trailingNumericCols[trailingNumericCols.length - 3] : 0;
    // Common layouts:
    // - amount balance               => tail2=amount, tail1=balance
    // - debit credit balance         => tail3=debit, tail2=credit, tail1=balance
    const hasDebitCreditBalanceLayout = trailingNumericCols.length >= 5;
    const hasExplicitDebitCreditCols = cols.length >= 6;
    const amountFromTail = hasDebitCreditBalanceLayout ? tail3 : tail2;
    const debitFromTail = hasDebitCreditBalanceLayout ? tail3 : 0;
    const creditFromTail = hasDebitCreditBalanceLayout ? tail2 : 0;
    const debit = hasExplicitDebitCreditCols ? (parseNumber(cols[3]) || debitFromTail) : debitFromTail;
    const credit = hasExplicitDebitCreditCols ? (parseNumber(cols[4]) || creditFromTail) : creditFromTail;

    let parsed: InvestmentTransaction | null = null;
    const buy = description.match(/Purchase of Security\s+([\d.,]+)\s+([A-Z0-9.\-]+)\s+@\s*(USD|SAR)\s*([\d.,]+)/i);
    if (buy) {
      const quantity = parseNumber(buy[1]);
      const symbol = String(buy[2] || '').toUpperCase();
      const quoteCurrency = String(buy[3] || 'USD').toUpperCase() === 'USD' ? 'USD' : 'SAR';
      let currency: 'SAR' | 'USD' = quoteCurrency;
      let price = parseNumber(buy[4]);
      const total = debit > 0 ? debit : amountFromTail > 0 ? amountFromTail : Math.max(0, quantity * price);
      if (opts?.statementCurrency && opts.statementCurrency !== quoteCurrency && quantity > 0 && total > 0) {
        currency = opts.statementCurrency;
        price = total / quantity;
        localWarn.add(`Converted buy rows from quote ${quoteCurrency} into statement currency ${opts.statementCurrency} using total/quantity.`);
      }
      parsed = {
        id: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date: dateYmd,
        type: 'buy',
        symbol,
        quantity,
        price,
        total,
        currency,
      } as InvestmentTransaction;
    }

    const sell = description.match(/Sale of Security\s+([\d.,]+)\s+([A-Z0-9.\-]+)\s+@\s*(USD|SAR)\s*([\d.,]+)/i);
    if (!parsed && sell) {
      const quantity = parseNumber(sell[1]);
      const symbol = String(sell[2] || '').toUpperCase();
      const quoteCurrency = String(sell[3] || 'USD').toUpperCase() === 'USD' ? 'USD' : 'SAR';
      let currency: 'SAR' | 'USD' = quoteCurrency;
      let price = parseNumber(sell[4]);
      const total = credit > 0 ? credit : amountFromTail > 0 ? amountFromTail : Math.max(0, quantity * price);
      if (opts?.statementCurrency && opts.statementCurrency !== quoteCurrency && quantity > 0 && total > 0) {
        currency = opts.statementCurrency;
        price = total / quantity;
        localWarn.add(`Converted sell rows from quote ${quoteCurrency} into statement currency ${opts.statementCurrency} using total/quantity.`);
      }
      parsed = {
        id: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date: dateYmd,
        type: 'sell',
        symbol,
        quantity,
        price,
        total,
        currency,
      } as InvestmentTransaction;
    }

    if (!parsed && /cash deposit|wire in/i.test(description)) {
      parsed = {
        id: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date: dateYmd,
        type: 'deposit',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: credit > 0 ? credit : amountFromTail > 0 ? amountFromTail : 0,
        currency: opts?.statementCurrency ?? 'SAR',
      } as InvestmentTransaction;
    }

    if (!parsed && /cash withdrawal|wire out/i.test(description)) {
      parsed = {
        id: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date: dateYmd,
        type: 'withdrawal',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: debit > 0 ? debit : amountFromTail > 0 ? amountFromTail : 0,
        currency: opts?.statementCurrency ?? 'SAR',
      } as InvestmentTransaction;
    }

    if (!parsed && /(fee|commission)/i.test(description)) {
      parsed = {
        id: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date: dateYmd,
        type: 'fee',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: debit > 0 ? debit : credit > 0 ? credit : amountFromTail > 0 ? amountFromTail : 0,
        currency: opts?.statementCurrency ?? 'SAR',
      } as InvestmentTransaction;
    }

    if (!parsed && /\bvat\b|value added tax/i.test(description)) {
      parsed = {
        id: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date: dateYmd,
        type: 'vat',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: debit > 0 ? debit : credit > 0 ? credit : amountFromTail > 0 ? amountFromTail : 0,
        currency: opts?.statementCurrency ?? 'SAR',
      } as InvestmentTransaction;
    }

    if (!parsed || !(parsed.total > 0)) continue;
    const key = `${parsed.date}|${parsed.type}|${parsed.symbol}|${parsed.quantity}|${parsed.price}|${parsed.total}|${parsed.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  if (opts?.warnings && localWarn.size > 0) opts.warnings.push(...Array.from(localWarn));
  return out;
}

export function extractInvestmentTransactionsFromAwaedTable(
  text: string,
  accountId: string,
  opts?: { statementCurrency?: 'SAR' | 'USD'; warnings?: string[] },
): InvestmentTransaction[] {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: InvestmentTransaction[] = [];
  const seen = new Set<string>();
  const statementCurrency = opts?.statementCurrency ?? inferStatementCurrency(text) ?? 'SAR';

  for (const line of lines) {
    const datePrefix = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}\s+/);
    if (!datePrefix) continue;
    const date = formatLocalYmd(parseDate(datePrefix[1]));
    const description = line.replace(/^(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}\s+([A-Za-z0-9-]+(?:\s+(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+)?)\s+/, '');
    const numericTokens = (line.match(/-?\d[\d,]*\.\d+/g) || []).map((v) => parseNumber(v)).filter((n) => Number.isFinite(n));
    const amount = numericTokens.length >= 2 ? numericTokens[numericTokens.length - 2] : numericTokens.length === 1 ? numericTokens[0] : 0;

    let parsed: InvestmentTransaction | null = null;
    const buyMatch = description.match(/Purchase of Security\s+([\d.,]+)\s+([A-Z0-9.\-]+)\s+@\s*(USD|SAR)\s*([\d.,]+)/i);
    if (buyMatch) {
      const quantity = parseNumber(buyMatch[1]);
      const symbol = normalizeSymbol(buyMatch[2]);
      const quoteCurrency = String(buyMatch[3] || 'USD').toUpperCase() === 'USD' ? 'USD' : 'SAR';
      const quotedPrice = parseNumber(buyMatch[4]);
      const total = amount > 0 ? amount : Math.max(0, quantity * quotedPrice);
      const currency = statementCurrency !== quoteCurrency && quantity > 0 && total > 0 ? statementCurrency : quoteCurrency;
      const price = currency === quoteCurrency ? quotedPrice : total / quantity;
      parsed = {
        id: `stmt-a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'buy',
        symbol,
        quantity,
        price,
        total,
        currency,
      };
    }

    const sellMatch = description.match(/Sale of Security\s+([\d.,]+)\s+([A-Z0-9.\-]+)\s+@\s*(USD|SAR)\s*([\d.,]+)/i);
    if (!parsed && sellMatch) {
      const quantity = parseNumber(sellMatch[1]);
      const symbol = normalizeSymbol(sellMatch[2]);
      const quoteCurrency = String(sellMatch[3] || 'USD').toUpperCase() === 'USD' ? 'USD' : 'SAR';
      const quotedPrice = parseNumber(sellMatch[4]);
      const total = amount > 0 ? amount : Math.max(0, quantity * quotedPrice);
      const currency = statementCurrency !== quoteCurrency && quantity > 0 && total > 0 ? statementCurrency : quoteCurrency;
      const price = currency === quoteCurrency ? quotedPrice : total / quantity;
      parsed = {
        id: `stmt-a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'sell',
        symbol,
        quantity,
        price,
        total,
        currency,
      };
    }

    if (!parsed && /(Purchase of Security|Sale of Security)/i.test(description)) {
      const qtySym = description.match(/Security\s+([\d.,]+)\s+([A-Z0-9.\-]+)/i);
      const pxCur = description.match(/@\s*(USD|SAR)\s*([\d.,]+)/i);
      if (qtySym && pxCur) {
        const quantity = parseNumber(qtySym[1]);
        const symbol = normalizeSymbol(qtySym[2]);
        const quoteCurrency = String(pxCur[1] || 'USD').toUpperCase() === 'USD' ? 'USD' : 'SAR';
        const quotedPrice = parseNumber(pxCur[2]);
        const total = amount > 0 ? amount : Math.max(0, quantity * quotedPrice);
        const currency = statementCurrency !== quoteCurrency && quantity > 0 && total > 0 ? statementCurrency : quoteCurrency;
        const price = currency === quoteCurrency ? quotedPrice : total / quantity;
        parsed = {
          id: `stmt-a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          accountId,
          date,
          type: /Sale of Security/i.test(description) ? 'sell' : 'buy',
          symbol,
          quantity,
          price,
          total,
          currency,
        };
      }
    }

    if (!parsed && /Cash Deposit\s*-\s*Wire In/i.test(description)) {
      parsed = {
        id: `stmt-a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'deposit',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: amount,
        currency: statementCurrency,
      };
    }

    if (!parsed && /Cash Withdrawal\s*-\s*Wire Out/i.test(description)) {
      parsed = {
        id: `stmt-a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'withdrawal',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: amount,
        currency: statementCurrency,
      };
    }

    if (!parsed && /(fee|commission)/i.test(description)) {
      parsed = {
        id: `stmt-a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'fee',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: amount,
        currency: statementCurrency,
      };
    }

    if (!parsed && /\bvat\b|value added tax/i.test(description)) {
      parsed = {
        id: `stmt-a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'vat',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total: amount,
        currency: statementCurrency,
      };
    }

    if (!parsed || !(parsed.total > 0)) continue;
    const key = `${parsed.date}|${parsed.type}|${parsed.symbol}|${parsed.quantity}|${parsed.price}|${parsed.total}|${parsed.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  if (out.length > 0 && opts?.warnings) {
    opts.warnings.push('Parsed rows from Awaed-style statement table format.');
  }
  return out;
}

export function extractInvestmentTransactionsFromHeuristicText(
  text: string,
  accountId: string,
  opts?: { statementCurrency?: 'SAR' | 'USD'; warnings?: string[] },
): InvestmentTransaction[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: InvestmentTransaction[] = [];
  const seen = new Set<string>();

  const toYmd = (raw: string) => formatLocalYmd(parseDate(raw));
  const push = (tx: InvestmentTransaction) => {
    if (!(tx.total > 0)) return;
    const key = `${tx.date}|${tx.type}|${tx.symbol}|${tx.quantity}|${tx.price}|${tx.total}|${tx.currency}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tx);
  };

  for (const line of lines) {
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
    if (!dateMatch) continue;
    const date = toYmd(dateMatch[1]);
    const currency = /(?:\bUSD\b|\$)/i.test(line) ? 'USD' : (opts?.statementCurrency ?? 'SAR');

    const trade = line.match(/(?:buy|purchase|sell|sale)\s+([\d.,]+)\s+([A-Z0-9.\-]+)(?:\s*@\s*(?:USD|SAR|\$)?\s*([\d.,]+))?/i);
    if (trade) {
      const type = /(sell|sale)/i.test(line) ? 'sell' : 'buy';
      const quantity = parseNumber(trade[1]);
      const symbol = String(trade[2] || '').toUpperCase();
      const price = parseNumber(trade[3]);
      const amountHit = line.match(/(?:amount|total|value)\s*[:=]?\s*(?:USD|SAR|\$)?\s*([\d,]+(?:\.\d+)?)/i);
      const total = amountHit ? parseNumber(amountHit[1]) : Math.max(0, quantity * price);
      push({
        id: `stmt-h-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: type as 'buy' | 'sell',
        symbol,
        quantity,
        price: price > 0 ? price : quantity > 0 ? total / quantity : 0,
        total,
        currency,
      });
      continue;
    }

    if (/(deposit|wire in|cash in|top ?up)/i.test(line)) {
      const amountHit = line.match(/(?:USD|SAR|\$)?\s*([\d,]+(?:\.\d+)?)/);
      const total = amountHit ? parseNumber(amountHit[1]) : 0;
      push({
        id: `stmt-h-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'deposit',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total,
        currency,
      });
      continue;
    }

    if (/(withdrawal|wire out|cash out)/i.test(line)) {
      const amountHit = line.match(/(?:USD|SAR|\$)?\s*([\d,]+(?:\.\d+)?)/);
      const total = amountHit ? parseNumber(amountHit[1]) : 0;
      push({
        id: `stmt-h-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        accountId,
        date,
        type: 'withdrawal',
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        total,
        currency,
      });
    }
  }
  if (out.length > 0 && opts?.warnings) {
    opts.warnings.push('Some investment rows were parsed using heuristic fallback because structured format detection was weak.');
  }
  return out;
}

export function extractInvestmentTransactionsFromTokenStream(
  text: string,
  accountId: string,
  opts?: { statementCurrency?: 'SAR' | 'USD'; warnings?: string[] },
): InvestmentTransaction[] {
  const compact = String(text || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return [];

  const out: InvestmentTransaction[] = [];
  const seen = new Set<string>();
  const push = (tx: InvestmentTransaction) => {
    if (!(tx.total > 0)) return;
    const key = `${tx.date}|${tx.type}|${tx.symbol}|${tx.quantity}|${tx.price}|${tx.total}|${tx.currency}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tx);
  };

  const currencyByText = (row: string): 'USD' | 'SAR' =>
    (/\bUSD\b|\$/i.test(row) ? 'USD' : (opts?.statementCurrency ?? 'SAR'));

  const refPattern = '[A-Za-z0-9-]+(?:\\s+[A-Za-z0-9-]+)?';
  const buySellRegex = new RegExp(`(\\d{2}\\/\\d{2}\\/\\d{4}(?:\\s+\\d{2}:\\d{2}:\\d{2})?)\\s+${refPattern}\\s+(Purchase of Security|Sale of Security)\\s+([\\d.,]+)\\s+([A-Z0-9.\\-]+)\\s+@\\s*(USD|SAR)\\s*([\\d.,]+)\\s+([\\d,]+(?:\\.\\d+)?)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = buySellRegex.exec(compact)) !== null) {
    const date = formatLocalYmd(parseDate(String(m[1]).split(' ')[0]));
    const type = /sale/i.test(String(m[2])) ? 'sell' : 'buy';
    const quantity = parseNumber(m[3]);
    const symbol = String(m[4] || '').toUpperCase();
    const quoteCurrency = String(m[5] || 'SAR').toUpperCase() === 'USD' ? 'USD' : 'SAR';
    const quotedPrice = parseNumber(m[6]);
    const amount = parseNumber(m[7]);
    let currency: 'USD' | 'SAR' = quoteCurrency;
    let price = quotedPrice;
    if (opts?.statementCurrency && opts.statementCurrency !== quoteCurrency && quantity > 0 && amount > 0) {
      currency = opts.statementCurrency;
      price = amount / quantity;
    }
    push({
      id: `stmt-c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      accountId,
      date,
      type: type as 'buy' | 'sell',
      symbol,
      quantity,
      price,
      total: amount,
      currency,
    });
  }

  const depositRegex = new RegExp(`(\\d{2}\\/\\d{2}\\/\\d{4}(?:\\s+\\d{2}:\\d{2}:\\d{2})?)\\s+${refPattern}\\s+Cash Deposit\\s*-\\s*Wire In\\s+([\\d,]+(?:\\.\\d+)?)`, 'gi');
  while ((m = depositRegex.exec(compact)) !== null) {
    const date = formatLocalYmd(parseDate(String(m[1]).split(' ')[0]));
    const total = parseNumber(m[2]);
    push({
      id: `stmt-c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      accountId,
      date,
      type: 'deposit',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total,
      currency: currencyByText(m[0]),
    });
  }

  const withdrawalRegex = new RegExp(`(\\d{2}\\/\\d{2}\\/\\d{4}(?:\\s+\\d{2}:\\d{2}:\\d{2})?)\\s+${refPattern}\\s+Cash Withdrawal\\s*-\\s*Wire Out\\s+([\\d,]+(?:\\.\\d+)?)`, 'gi');
  while ((m = withdrawalRegex.exec(compact)) !== null) {
    const date = formatLocalYmd(parseDate(String(m[1]).split(' ')[0]));
    const total = parseNumber(m[2]);
    push({
      id: `stmt-c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      accountId,
      date,
      type: 'withdrawal',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total,
      currency: currencyByText(m[0]),
    });
  }

  if (out.length > 0 && opts?.warnings) {
    opts.warnings.push('Parsed statement rows from compact PDF token stream (line breaks were missing).');
  }
  return out;
}

export function extractInvestmentTransactionsFromGlobalPattern(
  text: string,
  accountId: string,
  opts?: { statementCurrency?: 'SAR' | 'USD'; warnings?: string[] },
): InvestmentTransaction[] {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return [];
  const out: InvestmentTransaction[] = [];
  const seen = new Set<string>();
  const push = (tx: InvestmentTransaction) => {
    if (!(tx.total > 0)) return;
    const key = `${tx.date}|${tx.type}|${tx.symbol}|${tx.quantity}|${tx.price}|${tx.total}|${tx.currency}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tx);
  };

  const buySell = /(\d{1,2}\/\d{1,2}\/\d{4}).{0,80}?(Purchase of Security|Sale of Security)\s+([\d.,]+)\s+([A-Z0-9.\-]+)\s+@\s*(USD|SAR)\s*([\d.,]+)\s+([\d,]+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = buySell.exec(compact)) !== null) {
    const date = formatLocalYmd(parseDate(m[1]));
    const quantity = parseNumber(m[3]);
    const symbol = String(m[4] || '').toUpperCase();
    const quoteCurrency = String(m[5] || 'SAR').toUpperCase() === 'USD' ? 'USD' : 'SAR';
    let price = parseNumber(m[6]);
    const total = parseNumber(m[7]);
    let currency: 'SAR' | 'USD' = quoteCurrency;
    if (opts?.statementCurrency && opts.statementCurrency !== quoteCurrency && quantity > 0 && total > 0) {
      currency = opts.statementCurrency;
      price = total / quantity;
    }
    push({
      id: `stmt-g-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      accountId,
      date,
      type: /sale/i.test(m[2]) ? 'sell' : 'buy',
      symbol,
      quantity,
      price,
      total,
      currency,
    });
  }

  const cashInOut = /(\d{1,2}\/\d{1,2}\/\d{4}).{0,80}?(Cash Deposit\s*-\s*Wire In|Cash Withdrawal\s*-\s*Wire Out)\s+([\d,]+(?:\.\d+)?)/gi;
  while ((m = cashInOut.exec(compact)) !== null) {
    push({
      id: `stmt-g-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      accountId,
      date: formatLocalYmd(parseDate(m[1])),
      type: /withdrawal/i.test(m[2]) ? 'withdrawal' : 'deposit',
      symbol: 'CASH',
      quantity: 0,
      price: 0,
      total: parseNumber(m[3]),
      currency: opts?.statementCurrency ?? 'SAR',
    });
  }

  if (out.length > 0 && opts?.warnings) {
    opts.warnings.push('Recovered transactions using global-pattern parser fallback.');
  }
  return out;
}

function dedupeInvestmentTransactions(rows: InvestmentTransaction[]): InvestmentTransaction[] {
  const seen = new Set<string>();
  const out: InvestmentTransaction[] = [];
  for (const r of rows) {
    const k = `${r.date}|${r.type}|${r.symbol}|${Number(r.quantity).toFixed(6)}|${Number(r.price).toFixed(6)}|${Number(r.total).toFixed(6)}|${r.currency ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function parseNumber(v: unknown): number {
  const raw = String(v ?? '').replace(/,/g, '').trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSymbol(raw: unknown): string {
  const v = String(raw ?? '').toUpperCase().trim();
  return v.replace(/[^A-Z0-9.\-]/g, '');
}

function inferStatementCurrency(text: string): 'SAR' | 'USD' | undefined {
  const m = text.match(/Transaction\s+Statement\s*\((SAR|USD)\)/i) || text.match(/\((SAR|USD)\)/i);
  if (m) return String(m[1]).toUpperCase() === 'USD' ? 'USD' : 'SAR';

  const usdHits = (text.match(/@\s*USD\b|\bUSD\b|\$/gi) || []).length;
  const sarHits = (text.match(/@\s*SAR\b|\bSAR\b|Saudi\s+Riyal|Riyal/gi) || []).length;
  if (usdHits === 0 && sarHits === 0) return undefined;
  return usdHits > sarHits ? 'USD' : 'SAR';
}

/**
 * Helper functions
 */
function getFileType(fileName: string): 'pdf' | 'csv' | 'xlsx' | 'xls' | 'ofx' | 'qfx' | 'txt' | 'unknown' {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf': return 'pdf';
    case 'csv': return 'csv';
    case 'xlsx': return 'xlsx';
    case 'xls': return 'xls';
    case 'ofx': return 'ofx';
    case 'qfx': return 'qfx';
    case 'txt': return 'txt';
    default: return 'unknown';
  }
}

async function detectFileType(file: File): Promise<'pdf' | 'csv' | 'xlsx' | 'xls' | 'ofx' | 'qfx' | 'txt' | 'unknown'> {
  const byExt = getFileType(file.name);
  if (byExt !== 'unknown') return byExt;
  const mime = String(file.type || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('csv')) return 'csv';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('sheet')) return 'xlsx';
  if (mime.includes('text/')) return 'txt';

  const head = (await file.slice(0, 2048).text()).trim();
  if (!head) return 'unknown';
  if (head.startsWith('%PDF')) return 'pdf';
  if (/<OFX>|<BANKMSGSRSV1>|<INVSTMTRS>/i.test(head)) return 'ofx';
  if (/[,;\t]/.test(head) && /\d/.test(head)) return 'csv';
  return 'txt';
}

function parseDate(dateStr: string): Date {
  const trimmed = String(dateStr || '').trim();
  if (!trimmed) return new Date(NaN);

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10) - 1;
    const day = parseInt(iso[3], 10);
    const d = new Date(year, month, day);
    return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
  }
  const slash = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (slash) {
    const day = parseInt(slash[1], 10);
    const month = parseInt(slash[2], 10) - 1;
    const y = slash[3];
    const year = parseInt(y.length === 2 ? `20${y}` : y, 10);
    const d = new Date(year, month, day);
    return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
  }

  return new Date(NaN);
}

function inferCategory(description: string): string {
  const desc = description
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!desc) return 'Uncategorized';

  const merchantOverrides: Record<string, string> = {
    'starbucks': 'Food',
    'carrefour': 'Food',
    'tamimi': 'Food',
    'panda': 'Food',
    'careem': 'Transportation',
    'uber': 'Transportation',
    'netflix': 'Entertainment',
    'shahid': 'Entertainment',
    'stc': 'Telecommunications',
    'mobily': 'Telecommunications',
    'zain': 'Telecommunications',
    'jarir': 'Shopping',
    'amazon': 'Shopping',
  };
  for (const [merchant, category] of Object.entries(merchantOverrides)) {
    if (desc.includes(merchant)) return category;
  }

  const categoryKeywords: Record<string, string[]> = {
    Income: ['salary', 'payroll', 'deposit', 'راتب', 'ايداع', 'تحويل وارد'],
    Food: ['food', 'restaurant', 'cafe', 'coffee', 'grocery', 'supermarket', 'مطعم', 'مقهى', 'قهوة', 'بقالة', 'سوبرماركت'],
    Transportation: ['uber', 'taxi', 'fuel', 'petrol', 'gas', 'transport', 'metro', 'وقود', 'بنزين', 'نقل', 'تكسي'],
    Housing: ['rent', 'lease', 'apartment', 'housing', 'إيجار', 'سكن', 'شقة'],
    Utilities: ['electricity', 'water', 'internet', 'utility', 'كهرباء', 'مياه', 'انترنت', 'فاتورة'],
    Telecommunications: ['mobile', 'phone', 'sim', 'telecom', 'اتصالات', 'جوال', 'شريحة'],
    Entertainment: ['cinema', 'movie', 'game', 'subscription', 'ترفيه', 'سينما', 'اشتراك'],
    Shopping: ['shopping', 'store', 'retail', 'mall', 'متجر', 'تسوق', 'مول'],
    Health: ['pharmacy', 'clinic', 'hospital', 'medical', 'صيدلية', 'عيادة', 'مستشفى'],
    Education: ['school', 'tuition', 'course', 'education', 'جامعة', 'مدرسة', 'تعليم'],
    Travel: ['hotel', 'airline', 'flight', 'travel', 'ferry', 'فندق', 'طيران', 'سفر'],
  };

  let best: { category: string; score: number } = { category: 'Uncategorized', score: 0 };
  for (const [category, words] of Object.entries(categoryKeywords)) {
    const score = words.reduce((sum, w) => sum + (desc.includes(w) ? (w.length > 4 ? 2 : 1) : 0), 0);
    if (score > best.score) best = { category, score };
  }
  return best.score > 0 ? best.category : 'Uncategorized';
}

function canonicalizeTransactionDescription(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/^(بطاقة|card|account|a\/c)\s*[:\-]?\s*/i, '')
    .replace(/^(لدى|at|merchant|from)\s*[:\-]?\s*/i, '')
    .replace(/\b(sar|balance|رصيد|مبلغ)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Transaction';
}

/**
 * Validate extracted transactions
 */
export function validateTransactions(
  transactions: Transaction[],
  investmentTransactions?: InvestmentTransaction[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let validCount = 0;
  let invalidCount = 0;
  const duplicateKeys = new Set<string>();
  const seenKeys = new Set<string>();
  const dates: Date[] = [];
  const amounts: number[] = [];

  // Validate regular transactions
  transactions.forEach((tx, index) => {
    const txErrors: string[] = [];
    const txWarnings: string[] = [];

    // Required fields
    if (!tx.date) {
      txErrors.push(`Transaction ${index + 1}: Missing date`);
    } else {
      const date = new Date(tx.date);
      if (isNaN(date.getTime())) {
        txErrors.push(`Transaction ${index + 1}: Invalid date format`);
      } else {
        dates.push(date);
        // Check for future dates
        if (date > new Date()) {
          txWarnings.push(`Transaction ${index + 1}: Future date detected`);
        }
        // Check for very old dates (more than 10 years)
        const tenYearsAgo = new Date();
        tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
        if (date < tenYearsAgo) {
          txWarnings.push(`Transaction ${index + 1}: Very old date (${date.toLocaleDateString()})`);
        }
      }
    }

    if (!tx.description || tx.description.trim().length === 0) {
      txErrors.push(`Transaction ${index + 1}: Missing description`);
    } else if (tx.description.trim().length < 3) {
      txWarnings.push(`Transaction ${index + 1}: Very short description`);
    }

    if (tx.amount === undefined || tx.amount === null) {
      txErrors.push(`Transaction ${index + 1}: Missing amount`);
    } else {
      if (!Number.isFinite(tx.amount)) {
        txErrors.push(`Transaction ${index + 1}: Invalid amount (not a number)`);
      } else {
        amounts.push(Math.abs(tx.amount));
        // Check for suspiciously large amounts
        if (Math.abs(tx.amount) > 1000000) {
          txWarnings.push(`Transaction ${index + 1}: Very large amount (${tx.amount.toLocaleString()})`);
        }
        // Check for zero amounts
        if (tx.amount === 0) {
          txWarnings.push(`Transaction ${index + 1}: Zero amount transaction`);
        }
      }
    }

    if (!tx.accountId) {
      txErrors.push(`Transaction ${index + 1}: Missing account ID`);
    }

    // Check for duplicates within the statement
    const duplicateKey = `${tx.date}_${tx.amount}_${tx.description.substring(0, 20)}`;
    if (seenKeys.has(duplicateKey)) {
      duplicateKeys.add(duplicateKey);
      txWarnings.push(`Transaction ${index + 1}: Potential duplicate within statement`);
    } else {
      seenKeys.add(duplicateKey);
    }

    if (txErrors.length === 0) {
      validCount++;
    } else {
      invalidCount++;
      errors.push(...txErrors);
    }
    if (txWarnings.length > 0) {
      warnings.push(...txWarnings);
    }
  });

  // Validate investment transactions
  if (investmentTransactions) {
    investmentTransactions.forEach((tx, index) => {
      const txErrors: string[] = [];
      const txWarnings: string[] = [];

      if (!tx.date) {
        txErrors.push(`Investment transaction ${index + 1}: Missing date`);
      } else {
        const date = new Date(tx.date);
        if (isNaN(date.getTime())) {
          txErrors.push(`Investment transaction ${index + 1}: Invalid date format`);
        } else {
          dates.push(date);
        }
      }

      if (!tx.symbol || tx.symbol.trim().length === 0) {
        txErrors.push(`Investment transaction ${index + 1}: Missing symbol`);
      }

      if (tx.quantity === undefined || tx.quantity === null || !Number.isFinite(tx.quantity)) {
        txErrors.push(`Investment transaction ${index + 1}: Invalid quantity`);
      } else if (tx.quantity <= 0) {
        txWarnings.push(`Investment transaction ${index + 1}: Zero or negative quantity`);
      }

      if (tx.price === undefined || tx.price === null || !Number.isFinite(tx.price)) {
        txErrors.push(`Investment transaction ${index + 1}: Invalid price`);
      } else if (tx.price <= 0) {
        txWarnings.push(`Investment transaction ${index + 1}: Zero or negative price`);
      }

      if (!tx.accountId) {
        txErrors.push(`Investment transaction ${index + 1}: Missing account ID`);
      }
      if ((tx.currency || '').toUpperCase() !== 'SAR' && (tx.currency || '').toUpperCase() !== 'USD') {
        txWarnings.push(`Investment transaction ${index + 1}: Unsupported currency "${tx.currency}", defaulting to SAR`);
      }

      // Check for duplicates
      const duplicateKey = `${tx.date}_${tx.symbol}_${tx.type}_${tx.quantity}_${tx.price}`;
      if (seenKeys.has(duplicateKey)) {
        duplicateKeys.add(duplicateKey);
        txWarnings.push(`Investment transaction ${index + 1}: Potential duplicate within statement`);
      } else {
        seenKeys.add(duplicateKey);
      }

      if (txErrors.length === 0) {
        validCount++;
      } else {
        invalidCount++;
        errors.push(...txErrors);
      }
      if (txWarnings.length > 0) {
        warnings.push(...txWarnings);
      }
    });
  }

  // Calculate statistics
  const dateRange = dates.length > 0
    ? {
        start: new Date(Math.min(...dates.map(d => d.getTime()))).toISOString().split('T')[0],
        end: new Date(Math.max(...dates.map(d => d.getTime()))).toISOString().split('T')[0]
      }
    : null;

  const amountRange = amounts.length > 0
    ? {
        min: Math.min(...amounts),
        max: Math.max(...amounts),
        total: amounts.reduce((sum, amt) => sum + amt, 0)
      }
    : null;

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    statistics: {
      totalTransactions: transactions.length + (investmentTransactions?.length || 0),
      validTransactions: validCount,
      invalidTransactions: invalidCount,
      duplicateCount: duplicateKeys.size,
      dateRange,
      amountRange
    }
  };
}

/**
 * Validate file before processing
 */
export function validateFile(file: File): { isValid: boolean; error?: string } {
  // Check file size (10MB limit)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the maximum allowed size of 10MB`
    };
  }

  // Check file type
  const allowedExtensions = ['.pdf', '.csv', '.xlsx', '.xls', '.ofx', '.qfx', '.txt'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
  const mime = String(file.type || '').toLowerCase();
  const hasAllowedMime =
    mime.includes('pdf') ||
    mime.includes('csv') ||
    mime.includes('text/') ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime.includes('sheet');

  if (!hasValidExtension && !hasAllowedMime) {
    return {
      isValid: false,
      error: `Unsupported file type. Allowed types: ${allowedExtensions.join(', ')} (or equivalent MIME types).`
    };
  }

  // Check if file is empty
  if (file.size === 0) {
    return {
      isValid: false,
      error: 'File is empty'
    };
  }

  return { isValid: true };
}

function deduplicateTransactions(transactions: Transaction[]): Transaction[] {
  const seen = new Set<string>();
  return transactions.filter(tx => {
    const key = `${tx.date}-${tx.description}-${tx.amount}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeTransactionsDateConvention(transactions: Transaction[]): Transaction[] {
  return transactions.map((tx) => {
    const parsed = parseDate(String(tx.date || ''));
    const date = Number.isNaN(parsed.getTime()) ? formatLocalYmd(new Date()) : formatLocalYmd(parsed);
    return { ...tx, date };
  });
}

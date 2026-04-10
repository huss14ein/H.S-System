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

/**
 * Parse bank statement from uploaded file
 */
export async function parseBankStatement(
  file: File,
  accountId: string
): Promise<ParseResult> {
  const fileType = getFileType(file.name);
  
  try {
    let text = '';
    
    if (fileType === 'pdf') {
      text = await extractTextFromPDF(file);
    } else if (fileType === 'csv') {
      text = await parseCSV(file);
    } else if (fileType === 'ofx' || fileType === 'qfx') {
      // OFX/QFX are text-based; parse as text and let extractor normalize rows.
      text = await parseCSV(file);
    } else if (fileType === 'xlsx' || fileType === 'xls') {
      text = await parseExcel(file);
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
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
    // First try pattern-based extraction for common SMS formats
    const patternTransactions = extractTransactionsFromSMS(smsText, accountId);
    const heuristicTransactions = extractTransactionsFromSMSHeuristic(smsText, accountId);
    let aiTimedOut = false;

    // Then use AI to extract any additional transactions, but cap wait time to keep SMS import responsive.
    const aiTransactions = await Promise.race<Transaction[]>([
      extractTransactionsFromText(smsText, accountId, 'sms'),
      new Promise<Transaction[]>((resolve) => setTimeout(() => {
        aiTimedOut = true;
        resolve([]);
      }, 4000)),
    ]);
    
    // Merge and deduplicate
    const allTransactions = [...patternTransactions, ...heuristicTransactions, ...aiTransactions];
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
): Promise<{ transactions: InvestmentTransaction[]; confidence: number; errors?: string[]; warnings?: string[]; validation?: ValidationResult }> {
  const fileType = getFileType(file.name);
  
  try {
    let text = '';
    
    if (fileType === 'pdf') {
      text = await extractTextFromPDF(file);
    } else if (fileType === 'csv') {
      text = await parseCSV(file);
    } else if (fileType === 'xlsx' || fileType === 'xls') {
      text = await parseExcel(file);
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    // Extract investment transactions using AI
    const transactions = await extractInvestmentTransactionsFromText(text, accountId || '');
    
    // Validate extracted transactions
    const validation = validateTransactions([], transactions);
    
    return {
      transactions: validation.isValid ? transactions : transactions.filter((_, i) => {
        const txDate = new Date(transactions[i].date);
        return !isNaN(txDate.getTime()) && transactions[i].symbol && 
               transactions[i].quantity !== undefined && transactions[i].price !== undefined;
      }),
      confidence: validation.isValid ? 0.80 : Math.max(0, 0.80 - (validation.errors.length * 0.1)),
      errors: validation.errors,
      warnings: validation.warnings,
      validation
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
  // For now, use a simple approach - in production, you'd use a PDF parsing library
  // like pdf.js or send to a backend service with proper OCR
  
  try {
    // Try to use FileReader to read as text (works for some PDFs)
    const text = await file.text();
    
    // If that doesn't work well, we'll use AI to extract from the raw bytes
    // For now, return the text and let AI handle extraction
    return text;
  } catch (error) {
    // Fallback: convert to base64 and use AI
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    // Use AI to extract text from PDF
    return await extractTextFromPDFWithAI(base64);
  }
}

/**
 * Extract text from PDF using AI (fallback)
 */
async function extractTextFromPDFWithAI(_base64: string): Promise<string> {
  // In a real implementation, you'd send this to a backend service
  // that uses OCR or PDF parsing libraries
  // For now, return empty and let the AI extraction handle it
  return '';
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
        
        if (amount > 0 && description) {
          const canonicalDescription = canonicalizeTransactionDescription(description);
          const date = parseDate(dateStr || new Date().toISOString().split('T')[0]);
          const category = inferCategory(canonicalDescription);
          
          transactions.push({
            id: `sms-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date: date.toISOString().split('T')[0],
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
    const amountMatch =
      block.match(/(?:SAR|ر\.?س|ريال)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i) ??
      block.match(/([\d,]+(?:\.\d+)?)\s*(?:SAR|ر\.?س|ريال)/i);
    const amount = Number((amountMatch?.[1] ?? '0').replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return;

    const dateMatch = block.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
    const parsedDate = parseDate(dateMatch?.[1] ?? '');
    const dateIso = Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString().slice(0, 10)
      : parsedDate.toISOString().slice(0, 10);

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
  const dateRe = /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/;
  const lines = smsText.split('\n').map((l) => l.trim()).filter(Boolean);
  const signatures = new Set(out.map((t) => `${t.date}|${t.amount}|${t.description.toLowerCase()}`));
  for (let i = 0; i < lines.length; i++) {
    if (!dateRe.test(lines[i])) continue;
    const window = [lines[i], lines[i - 1], lines[i - 2], lines[i + 1]].filter(Boolean).join('\n');
    const amountMatch =
      window.match(/(?:SAR|ر\.?س|ريال)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i) ??
      window.match(/([\d,]+(?:\.\d+)?)\s*(?:SAR|ر\.?س|ريال)/i);
    const amount = Number((amountMatch?.[1] ?? '0').replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const parsedDate = parseDate(lines[i]);
    const dateIso = Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString().slice(0, 10)
      : parsedDate.toISOString().slice(0, 10);
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
  const startRe = /(purchase|payment|transaction|debited|credited|withdrawn|received|شراء|سحب|خصم|نقاط البيع)/i;
  const dateRe = /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/;

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

/**
 * Extract transactions from text using AI
 */
async function extractTransactionsFromText(
  text: string,
  accountId: string,
  source: 'bank' | 'sms'
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
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text || response?.text || '';
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return parsed.map((tx: any) => ({
      id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      date: tx.date || new Date().toISOString().split('T')[0],
      description: tx.description || 'Unknown Transaction',
      amount: typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0,
      category: capitalizeCategoryName(tx.category || 'Uncategorized'),
      accountId,
      type: tx.type || (tx.amount < 0 ? 'expense' : 'income'),
      status: 'Approved' as const
    }));
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
- Type (buy, sell, dividend, deposit, withdrawal)
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

/**
 * Helper functions
 */
function getFileType(fileName: string): 'pdf' | 'csv' | 'xlsx' | 'xls' | 'ofx' | 'qfx' {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf': return 'pdf';
    case 'csv': return 'csv';
    case 'xlsx': return 'xlsx';
    case 'xls': return 'xls';
    case 'ofx': return 'ofx';
    case 'qfx': return 'qfx';
    default: return 'pdf';
  }
}

function parseDate(dateStr: string): Date {
  // Try different date formats
  const formats = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // DD/MM/YYYY
    /(\d{1,2})\/(\d{1,2})\/(\d{2})/, // DD/MM/YY
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
  ];
  
  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      if (format.source.includes('YYYY-MM-DD')) {
        return new Date(match[0]);
      } else {
        const day = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        const year = parseInt(match[3].length === 2 ? `20${match[3]}` : match[3]);
        return new Date(year, month, day);
      }
    }
  }
  
  // Fallback to today
  return new Date();
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
  const allowedExtensions = ['.pdf', '.csv', '.xlsx', '.xls', '.ofx', '.qfx'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));

  if (!hasValidExtension) {
    return {
      isValid: false,
      error: `Unsupported file type. Allowed types: ${allowedExtensions.join(', ')}`
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

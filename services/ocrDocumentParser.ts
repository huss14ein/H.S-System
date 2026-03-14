// OCR & Document Parsing Service for Financial Statements

export interface ParsedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  balance?: number;
  rawText: string;
  confidence: number;
}

export interface ParsedStatement {
  bankName?: string;
  accountNumber?: string;
  accountType?: 'checking' | 'savings' | 'credit' | 'investment';
  statementPeriod: {
    startDate: Date;
    endDate: Date;
  };
  openingBalance: number;
  closingBalance: number;
  transactions: ParsedTransaction[];
  summary: {
    totalCredits: number;
    totalDebits: number;
    transactionCount: number;
  };
  confidence: number;
}

export interface BankTemplate {
  bankName: string;
  patterns: {
    date: RegExp;
    description: RegExp;
    amount: RegExp;
    balance?: RegExp;
    transactionStart?: RegExp;
    transactionEnd?: RegExp;
    summary?: {
      openingBalance?: RegExp;
      closingBalance?: RegExp;
      totalCredits?: RegExp;
      totalDebits?: RegExp;
    };
  };
  dateFormat: string;
  amountFormat: 'US' | 'EU';
  skipPatterns: RegExp[];
}

class OCRDocumentParser {
  private templates: Map<string, BankTemplate> = new Map();
  private tesseractWorker: any = null;

  constructor() {
    this.initializeTemplates();
  }

  private initializeTemplates() {
    // Chase Bank Template
    this.templates.set('chase', {
      bankName: 'Chase',
      patterns: {
        date: /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
        description: /\b(.+?)\s+\$?[\d,]+\.\d{2}\b/,
        amount: /\$?([\d,]+\.\d{2})/,
        balance: /\$?([\d,]+\.\d{2})\s*$/,
        transactionStart: /Transactions/i,
        transactionEnd: /Summary|Total/i,
        summary: {
          openingBalance: /Opening Balance.*?\$?([\d,]+\.\d{2})/i,
          closingBalance: /Closing Balance.*?\$?([\d,]+\.\d{2})/i,
          totalCredits: /Total Credits.*?\$?([\d,]+\.\d{2})/i,
          totalDebits: /Total Debits.*?\$?([\d,]+\.\d{2})/i
        }
      },
      dateFormat: 'MM/DD/YYYY',
      amountFormat: 'US',
      skipPatterns: [
        /^Page \d+ of \d+$/i,
        /^Chase Bank/i,
        /^Account Summary/i,
        /^\s*$/
      ]
    });

    // Bank of America Template
    this.templates.set('bankofamerica', {
      bankName: 'Bank of America',
      patterns: {
        date: /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
        description: /\b(.+?)\s+\$?[\d,]+\.\d{2}\b/,
        amount: /\$?([\d,]+\.\d{2})/,
        balance: /\$?([\d,]+\.\d{2})\s*$/,
        transactionStart: /Transaction Detail/i,
        transactionEnd: /Account Summary/i,
        summary: {
          openingBalance: /Beginning Balance.*?\$?([\d,]+\.\d{2})/i,
          closingBalance: /Ending Balance.*?\$?([\d,]+\.\d{2})/i
        }
      },
      dateFormat: 'MM/DD/YYYY',
      amountFormat: 'US',
      skipPatterns: [
        /^Bank of America/i,
        /^Account Detail/i,
        /^\s*$/
      ]
    });

    // Wells Fargo Template
    this.templates.set('wellsfargo', {
      bankName: 'Wells Fargo',
      patterns: {
        date: /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
        description: /\b(.+?)\s+\$?[\d,]+\.\d{2}\b/,
        amount: /\$?([\d,]+\.\d{2})/,
        balance: /\$?([\d,]+\.\d{2})\s*$/,
        transactionStart: /Transaction History/i,
        transactionEnd: /Account Summary/i
      },
      dateFormat: 'MM/DD/YYYY',
      amountFormat: 'US',
      skipPatterns: [
        /^Wells Fargo/i,
        /^Account Activity/i,
        /^\s*$/
      ]
    });

    // Generic Template (fallback)
    this.templates.set('generic', {
      bankName: 'Generic',
      patterns: {
        date: /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/,
        description: /\b(.+?)\s+[-+]?\$?[\d,]+\.\d{2}\b/,
        amount: /[-+]?\$?([\d,]+\.\d{2})/,
        balance: /[-+]?\$?([\d,]+\.\d{2})\s*$/
      },
      dateFormat: 'MM/DD/YYYY',
      amountFormat: 'US',
      skipPatterns: [
        /^\s*$/,
        /^Page \d+/i,
        /^Total/i,
        /^Balance/i
      ]
    });
  }

  async initializeOCR() {
    if (typeof window !== 'undefined' && !this.tesseractWorker) {
      try {
        // In a real implementation, you would load Tesseract.js
        // const Tesseract = await import('tesseract.js');
        // this.tesseractWorker = await Tesseract.createWorker();
        // await this.tesseractWorker.loadLanguage('eng');
        // await this.tesseractWorker.initialize('eng');
        // eslint-disable-next-line no-console
        console.log('OCR initialized');
      } catch (error) {
        console.warn('OCR initialization failed:', error);
      }
    }
  }

  async parsePDF(file: File): Promise<ParsedStatement> {
    await this.initializeOCR();

    try {
      // In a real implementation, you would use pdf-parse or similar library
      const text = await this.extractTextFromPDF(file);
      return this.parseText(text);
    } catch (error) {
      console.error('PDF parsing failed:', error);
      throw new Error('Failed to parse PDF statement');
    }
  }

  async parseCSV(file: File): Promise<ParsedStatement> {
    try {
      const text = await this.extractTextFromCSV(file);
      return this.parseText(text);
    } catch (error) {
      console.error('CSV parsing failed:', error);
      throw new Error('Failed to parse CSV statement');
    }
  }

  async parseExcel(file: File): Promise<ParsedStatement> {
    try {
      const text = await this.extractTextFromExcel(file);
      return this.parseText(text);
    } catch (error) {
      console.error('Excel parsing failed:', error);
      throw new Error('Failed to parse Excel statement');
    }
  }

  private async extractTextFromPDF(file: File): Promise<string> {
    // Simulated PDF text extraction
    // In a real implementation, you would use pdf-parse or pdf.js
    return `
Chase Bank Statement
Account: ****1234
Period: 01/01/2024 - 01/31/2024

Transactions
01/02/2024 Starbucks Coffee $5.50 $1,000.00
01/03/2024 Salary Deposit $3,000.00 $3,005.50
01/05/2024 Amazon Purchase $125.99 $2,879.51
01/06/2024 Netflix Subscription $15.99 $2,863.52
01/10/2024 Gas Station $45.00 $2,818.52
01/15/2024 Grocery Store $87.43 $2,731.09
01/20/2024 Restaurant $62.50 $2,668.59
01/25/2024 Electric Bill $120.00 $2,548.59

Summary
Opening Balance: $1,000.00
Closing Balance: $2,548.59
Total Credits: $3,000.00
Total Debits: $1,451.41
    `.trim();
  }

  private async extractTextFromCSV(file: File): Promise<string> {
    // Simulated CSV text extraction
    return `
Date,Description,Amount,Balance
01/02/2024,Starbucks Coffee,-5.50,1000.00
01/03/2024,Salary Deposit,3000.00,3005.50
01/05/2024,Amazon Purchase,-125.99,2879.51
01/06/2024,Netflix Subscription,-15.99,2863.52
01/10/2024,Gas Station,-45.00,2818.52
01/15/2024,Grocery Store,-87.43,2731.09
01/20/2024,Restaurant,-62.50,2668.59
01/25/2024,Electric Bill,-120.00,2548.59
    `.trim();
  }

  private async extractTextFromExcel(file: File): Promise<string> {
    // Simulated Excel text extraction
    return this.extractTextFromCSV(file);
  }

  private parseText(text: string): ParsedStatement {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Detect bank template
    const template = this.detectBankTemplate(text);
    
    // Extract statement information
    const statement: ParsedStatement = {
      bankName: template.bankName,
      accountNumber: this.extractAccountNumber(text, template),
      accountType: this.extractAccountType(text, template),
      statementPeriod: this.extractStatementPeriod(text, template),
      openingBalance: this.extractOpeningBalance(text, template),
      closingBalance: this.extractClosingBalance(text, template),
      transactions: [],
      summary: {
        totalCredits: 0,
        totalDebits: 0,
        transactionCount: 0
      },
      confidence: 0
    };

    // Extract transactions
    statement.transactions = this.extractTransactions(lines, template);
    
    // Calculate summary
    statement.summary = this.calculateSummary(statement.transactions);
    statement.confidence = this.calculateConfidence(statement, template);

    return statement;
  }

  private detectBankTemplate(text: string): BankTemplate {
    const lowerText = text.toLowerCase();
    
    for (const [key, template] of this.templates) {
      if (key === 'generic') continue;
      
      if (lowerText.includes(template.bankName.toLowerCase())) {
        return template;
      }
    }
    
    return this.templates.get('generic')!;
  }

  private extractAccountNumber(text: string, template: BankTemplate): string | undefined {
    const accountMatch = text.match(/Account[:\s*]+(\*{4,}\d+)/i);
    return accountMatch ? accountMatch[1] : undefined;
  }

  private extractAccountType(text: string, template: BankTemplate): 'checking' | 'savings' | 'credit' | 'investment' | undefined {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('checking')) return 'checking';
    if (lowerText.includes('savings')) return 'savings';
    if (lowerText.includes('credit')) return 'credit';
    if (lowerText.includes('investment')) return 'investment';
    
    return undefined;
  }

  private extractStatementPeriod(text: string, template: BankTemplate): { startDate: Date; endDate: Date } {
    const periodMatch = text.match(/Period[:\s*]+(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    
    if (periodMatch) {
      return {
        startDate: this.parseDate(periodMatch[1], template.dateFormat),
        endDate: this.parseDate(periodMatch[2], template.dateFormat)
      };
    }
    
    // Fallback: extract from transaction dates
    const dateMatches = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g);
    if (dateMatches && dateMatches.length >= 2) {
      const dates = dateMatches.map(d => this.parseDate(d, template.dateFormat)).sort((a, b) => a.getTime() - b.getTime());
      return {
        startDate: dates[0],
        endDate: dates[dates.length - 1]
      };
    }
    
    const now = new Date();
    return {
      startDate: new Date(now.getFullYear(), now.getMonth(), 1),
      endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0)
    };
  }

  private extractOpeningBalance(text: string, template: BankTemplate): number {
    if (template.patterns.summary?.openingBalance) {
      const match = text.match(template.patterns.summary.openingBalance);
      if (match) {
        return this.parseAmount(match[1], template.amountFormat);
      }
    }
    return 0;
  }

  private extractClosingBalance(text: string, template: BankTemplate): number {
    if (template.patterns.summary?.closingBalance) {
      const match = text.match(template.patterns.summary.closingBalance);
      if (match) {
        return this.parseAmount(match[1], template.amountFormat);
      }
    }
    return 0;
  }

  private extractTransactions(lines: string[], template: BankTemplate): ParsedTransaction[] {
    const transactions: ParsedTransaction[] = [];
    let inTransactionSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if we're entering the transaction section
      if (template.patterns.transactionStart && line.match(template.patterns.transactionStart)) {
        inTransactionSection = true;
        continue;
      }
      
      // Check if we're leaving the transaction section
      if (template.patterns.transactionEnd && line.match(template.patterns.transactionEnd)) {
        inTransactionSection = false;
        continue;
      }
      
      // Skip lines that match skip patterns
      if (template.skipPatterns.some(pattern => line.match(pattern))) {
        continue;
      }
      
      // Try to extract transaction from current line
      if (inTransactionSection || !template.patterns.transactionStart) {
        const transaction = this.parseTransactionLine(line, template);
        if (transaction) {
          transactions.push(transaction);
        }
      }
    }
    
    return transactions;
  }

  private parseTransactionLine(line: string, template: BankTemplate): ParsedTransaction | null {
    const dateMatch = line.match(template.patterns.date);
    if (!dateMatch) return null;
    
    const amountMatch = line.match(template.patterns.amount);
    if (!amountMatch) return null;
    
    const descriptionMatch = line.match(template.patterns.description);
    const balanceMatch = template.patterns.balance ? line.match(template.patterns.balance) : null;
    
    const date = this.parseDate(dateMatch[1], template.dateFormat);
    const amount = this.parseAmount(amountMatch[1], template.amountFormat);
    const description = descriptionMatch ? descriptionMatch[1].trim() : line.trim();
    const balance = balanceMatch ? this.parseAmount(balanceMatch[1], template.amountFormat) : undefined;
    
    return {
      date,
      description,
      amount,
      type: amount >= 0 ? 'credit' : 'debit',
      balance,
      rawText: line,
      confidence: this.calculateTransactionConfidence(line, template)
    };
  }

  private parseDate(dateString: string, format: string): Date {
    // Simple date parsing - in a real implementation, you'd use a proper date library
    const parts = dateString.split(/[\/-]/);
    
    if (format === 'MM/DD/YYYY') {
      return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
    } else if (format === 'YYYY-MM-DD') {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    
    return new Date(dateString);
  }

  private parseAmount(amountString: string, format: 'US' | 'EU'): number {
    // Remove currency symbols and commas
    const cleanAmount = amountString.replace(/[$,]/g, '');
    return parseFloat(cleanAmount);
  }

  private calculateTransactionConfidence(line: string, template: BankTemplate): number {
    let confidence = 0.5; // Base confidence
    
    // Check for date match
    if (line.match(template.patterns.date)) confidence += 0.2;
    
    // Check for amount match
    if (line.match(template.patterns.amount)) confidence += 0.2;
    
    // Check for description match
    if (line.match(template.patterns.description)) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  private calculateSummary(transactions: ParsedTransaction[]) {
    const credits = transactions.filter(t => t.type === 'credit');
    const debits = transactions.filter(t => t.type === 'debit');
    
    return {
      totalCredits: credits.reduce((sum, t) => sum + t.amount, 0),
      totalDebits: Math.abs(debits.reduce((sum, t) => sum + t.amount, 0)),
      transactionCount: transactions.length
    };
  }

  private calculateConfidence(statement: ParsedStatement, template: BankTemplate): number {
    let confidence = 0.5; // Base confidence
    
    // Check for bank name detection
    if (template.bankName !== 'Generic') confidence += 0.1;
    
    // Check for account number
    if (statement.accountNumber) confidence += 0.1;
    
    // Check for statement period
    if (statement.statementPeriod.startDate && statement.statementPeriod.endDate) {
      confidence += 0.1;
    }
    
    // Check for opening/closing balances
    if (statement.openingBalance > 0 || statement.closingBalance > 0) confidence += 0.1;
    
    // Check transaction confidence
    if (statement.transactions.length > 0) {
      const avgTransactionConfidence = statement.transactions.reduce((sum, t) => sum + t.confidence, 0) / statement.transactions.length;
      confidence += avgTransactionConfidence * 0.2;
    }
    
    return Math.min(confidence, 1.0);
  }
}

export const ocrParser = new OCRDocumentParser();
export default OCRDocumentParser;

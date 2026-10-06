/**
 * Bank-agnostic SMS detectors for ATM cash withdrawals and credit-card settlements.
 * Covers Al Rajhi, Alinma, SNB, SAB/SABB, STC Bank, and common English KSA templates.
 */

/** ATM / cash-machine withdrawal (Arabic + English). */
export const SMS_ATM_WITHDRAWAL_RE =
  /(?:صراف\s*آ?لي|جهاز\s*(?:الصراف|ATM)|سحب\s*نقد(?:ي|ية)?|\batm\b|cash\s*withdrawals?|cash\s*withdrawn|atm\s*(?:cash\s*)?withdrawals?|withdrawn?\s*(?:from\s*)?(?:an?\s*)?atm)/i;

/**
 * Payment applied TO a credit/debit card (settlement / سداد) — credit on the card ledger.
 * Avoid bare "سداد" alone (utility SADAD bills) and bare "payment" (POS purchases).
 */
export const SMS_CARD_SETTLEMENT_RE =
  /(?:بطاقة[^\n]{0,80}سداد|(?:فيزا|visa|mastercard|ماستركارد|مدى|amex|american\s*express)[^\n]{0,40}سداد|سداد\s*(?:بطاقة|البطاقة|بطاقتك|بطاقتكم|بطاقة\s*ائتمان)|تم\s*سداد\s*(?:بطاقة|البطاقة|بطاقتك)|دفعة\s*(?:على|ل(?:ـ|ل)?)\s*(?:ال)?بطاقة|card\s*payment\s*(?:received|credited|posted)?|cc\s*payment|credit\s*card\s*(?:payment|settlement|paid)|payment\s*(?:received|credited|posted)\s*(?:to|on|onto)\s*(?:your\s*)?(?:credit\s*)?card|(?:your\s*)?(?:credit\s*)?card[^\n]{0,60}(?:has\s+been\s+)?(?:credited|payment\s*received)|(?:credit\s*)?card\s*\*?\d{4}[^\n]{0,40}credited|paid\s*(?:to|towards)\s*(?:your\s*)?(?:credit\s*)?card|credited\s+with\s+(?:SAR|SR))/i;

/** Soft English/Arabic credit markers used with a Credit account (multi-line SMS). */
export const SMS_CARD_CREDIT_SOFT_RE =
  /(?:payment\s*received|card\s*credited|has\s+been\s+credited|credited\s+with|تم\s*السداد|تم\s*سداد|سداد)/i;

/**
 * Outgoing local / internal bank transfer (حوالة) — Al Rajhi, Alinma, SNB-style Arabic + English.
 * Matches "حوالة محلية صادرة" / "حوالة داخلية صادرة" and common EN templates.
 */
export const SMS_ACCOUNT_TRANSFER_OUT_RE =
  /(?:حوالة\s*(?:محلية|داخلية|فورية)?\s*صادرة|تحويل\s*(?:محلي|داخلي)?\s*صادر|outgoing\s*(?:local\s*)?transfer|local\s*transfer\s*(?:out|outgoing)?|internal\s*transfer\s*(?:out|outgoing)?|transfer\s*out(?:going)?)/i;

/** Destination account last-4 on حوالة lines: لـ0001;Name or to *0001 */
export const SMS_TRANSFER_DEST_LAST4_RE =
  /(?:لـ\s*|ل\s*|to\s*(?:account\s*)?(?:ending\s*)?|to\s*\*)(\d{4})(?!\d)/i;

export function smsTextLooksLikeAtmWithdrawal(text: string): boolean {
  return SMS_ATM_WITHDRAWAL_RE.test(String(text || ''));
}

export function smsTextLooksLikeCardSettlement(text: string): boolean {
  return SMS_CARD_SETTLEMENT_RE.test(String(text || ''));
}

export function smsTextLooksLikeAccountTransferOut(text: string): boolean {
  return SMS_ACCOUNT_TRANSFER_OUT_RE.test(String(text || ''));
}

/** Last-4 of the destination account on an outgoing حوالة SMS (`لـ0001;…`). */
export function extractSmsTransferDestinationLast4(text: string): string | null {
  const m = String(text || '').match(SMS_TRANSFER_DEST_LAST4_RE);
  if (!m?.[1]) return null;
  return m[1];
}

/** Bank fee on the same SMS block (`رسوم:SR 0.58`). */
export function extractSmsTransferFeeAmount(text: string): number {
  const amountToken = String.raw`(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)`;
  const m = String(text || '').match(
    new RegExp(
      String.raw`(?:رسوم(?:\s*و?\s*ضريبة)?|fee(?:\s*&?\s*tax)?)\s*[:\-]?\s*(?:SAR|SR|ر\.?س)?\s*${amountToken}`,
      'i',
    ),
  );
  if (!m?.[1]) return 0;
  const n = Number(String(m[1]).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * True when a positive amount on a Credit account looks like a card payment,
 * even if the settlement phrase and amount landed on different lines after split.
 */
export function smsLooksLikeCardSettlementCredit(opts: {
  text: string;
  amount: number;
  accountType?: string | null;
}): boolean {
  if (!(Number(opts.amount) > 0)) return false;
  const text = String(opts.text || '');
  if (smsTextLooksLikeCardSettlement(text)) return true;
  if (String(opts.accountType || '') !== 'Credit') return false;
  return SMS_CARD_CREDIT_SOFT_RE.test(text);
}

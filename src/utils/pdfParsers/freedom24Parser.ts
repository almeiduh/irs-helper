import type { TaxRow, TaxRow8A, ParsedPdfData } from '../../types';
import { resolveCountryCodeFromIsin } from '../brokerCountries';
import { BrokerParsingError } from '../parserErrors';
import { normalizeNumber, extractPdfText, matchesAnyMarker } from './common';

// ---------------------------------------------------------------------------
// Content fingerprints
// ---------------------------------------------------------------------------

const FREEDOM24_MARKERS = [
  /Freedom24/i,
  /Trade\s+report\s+for\s+a\s+tax\s+return/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isinToCountryCode(isin: string): string {
  return resolveCountryCodeFromIsin(isin) ?? '840';
}

function formatAsset(ticker: string, isin: string): string {
  return `${ticker} (${isin})`;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const REGEX_FREEDOM24_DIVIDEND =
  /\b(\d{7,})\s+(\d{4}-\d{2}-\d{2})\s+(\S+)\s+([A-Z]{2}[A-Z0-9]{10})\s+(?:dividend|coupon)\s+((?:-?[\d.]+[A-Z]{2,3}\s+){0,2})([A-Z]{3})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;

const REGEX_FREEDOM24_STOCK_TRADE =
  /([D]?\d{7,})\s+\d+\s+(\S+)\s+([A-Z]{2}[A-Z0-9]{10})\s+Stocks\s+\S+\s+(Buy|Sell)\s+([\d.]+)\s+[\d.]+\s+([A-Z]{3})\s+([\d.]+)\s+-?[\d.]+\s+([\d.]+)\s+-?[\d.]+\s+([\d.]+)[A-Z]{3}\s+(\d{4}-\d{2}-\d{2})/g;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Freedom24TradeRecord {
  ticker: string;
  isin: string;
  direction: 'Buy' | 'Sell';
  quantity: number;
  currency: string;
  amount: number;
  exchangeRate: number;
  feeAmount: number;
  settlementDate: string;
}

// ---------------------------------------------------------------------------
// Internal functions
// ---------------------------------------------------------------------------

function parseFreedom24TaxFields(taxFieldsStr: string): number {
  let total = 0;
  const parts = taxFieldsStr.trim().split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^-?([\d.]+)[A-Z]{2,3}$/);
    if (m) {
      total += parseFloat(m[1]);
    }
  }
  return total;
}

function buildFreedom24Rows92A(trades: Freedom24TradeRecord[]): TaxRow[] {
  const sorted = [...trades].sort((a, b) => a.settlementDate.localeCompare(b.settlementDate));

  const buyPool: Record<string, Array<{ trade: Freedom24TradeRecord; remainingQty: number }>> = {};
  const rows: TaxRow[] = [];

  for (const trade of sorted) {
    if (trade.direction === 'Buy') {
      if (!buyPool[trade.ticker]) buyPool[trade.ticker] = [];
      buyPool[trade.ticker].push({ trade, remainingQty: trade.quantity });
    } else {
      const pool = buyPool[trade.ticker] ?? [];
      let remainingSellQty = trade.quantity;

      while (remainingSellQty > 0 && pool.length > 0) {
        const buyEntry = pool[0];
        if (buyEntry.remainingQty <= 0) {
          pool.shift();
          continue;
        }

        const matchedQty = Math.min(buyEntry.remainingQty, remainingSellQty);
        const sellProportion = matchedQty / trade.quantity;
        const buyProportion = matchedQty / buyEntry.trade.quantity;

        const valorRealizacao = trade.amount * sellProportion * trade.exchangeRate;
        const valorAquisicao = buyEntry.trade.amount * buyProportion * buyEntry.trade.exchangeRate;
        const despesasEncargos =
          trade.feeAmount * sellProportion * trade.exchangeRate +
          buyEntry.trade.feeAmount * buyProportion * buyEntry.trade.exchangeRate;

        const saleDateParts = trade.settlementDate.split('-');
        const buyDateParts = buyEntry.trade.settlementDate.split('-');
        const countryCode = isinToCountryCode(trade.isin);

        rows.push({
          codPais: countryCode,
          codigo: 'G20',
          anoRealizacao: saleDateParts[0],
          mesRealizacao: String(parseInt(saleDateParts[1], 10)),
          diaRealizacao: String(parseInt(saleDateParts[2], 10)),
          valorRealizacao: valorRealizacao.toFixed(2),
          anoAquisicao: buyDateParts[0],
          mesAquisicao: String(parseInt(buyDateParts[1], 10)),
          diaAquisicao: String(parseInt(buyDateParts[2], 10)),
          valorAquisicao: valorAquisicao.toFixed(2),
          despesasEncargos: despesasEncargos.toFixed(2),
          impostoPagoNoEstrangeiro: '0.00',
          codPaisContraparte: countryCode,
          _asset: formatAsset(trade.ticker, trade.isin),
        });

        buyEntry.remainingQty -= matchedQty;
        remainingSellQty -= matchedQty;

        if (buyEntry.remainingQty <= 0) {
          pool.shift();
        }
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseFreedom24Pdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  const looksLikeF24 = matchesAnyMarker(fullText, FREEDOM24_MARKERS);
  if (!looksLikeF24) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a Freedom24 Trade Report. Please upload the correct file.`,
      'parser.error.freedom24_wrong_file',
      { fileName: file.name },
    );
  }

  // --- Dividends / coupons → rows8A ---
  const rows8A: TaxRow8A[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_FREEDOM24_DIVIDEND.source, REGEX_FREEDOM24_DIVIDEND.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const isin = match[4];
      const ticker = match[3];
      const taxFieldsStr = match[5];
      const exchangeRate = parseFloat(match[8]);
      const amountInEur = match[9];

      const totalTaxInOriginalCurrency = parseFreedom24TaxFields(taxFieldsStr);
      const impostoPago = (totalTaxInOriginalCurrency * exchangeRate).toFixed(2);
      const countryCode = isinToCountryCode(isin);

      rows8A.push({
        codigo: 'E11',
        codPais: countryCode,
        rendimentoBruto: normalizeNumber(amountInEur),
        impostoPago,
        _asset: formatAsset(ticker, isin),
      });
    }
  }

  // --- Stock trades → rows92A (FIFO matching) ---
  const trades: Freedom24TradeRecord[] = [];
  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_FREEDOM24_STOCK_TRADE.source, REGEX_FREEDOM24_STOCK_TRADE.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      trades.push({
        ticker: match[2],
        isin: match[3],
        direction: match[4] as 'Buy' | 'Sell',
        quantity: parseFloat(match[5]),
        currency: match[6],
        amount: parseFloat(match[7]),
        exchangeRate: parseFloat(match[8]),
        feeAmount: parseFloat(match[9]),
        settlementDate: match[10],
      });
    }
  }

  const rows92A = buildFreedom24Rows92A(trades);

  const totalRows = rows8A.length + rows92A.length;
  if (totalRows === 0) {
    throw new BrokerParsingError(
      `No dividend or trade data found in "${file.name}". Please verify this is a Freedom24 Trade Report.`,
      'parser.error.freedom24_no_rows',
      { fileName: file.name },
    );
  }

  return {
    rows8A,
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}

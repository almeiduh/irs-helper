import type { TaxRow, TaxRow8A, TaxRowG13, ParsedPdfData } from '../../types';
import { resolveCountryCodeFromIsin } from '../brokerCountries';
import { BrokerParsingError } from '../parserErrors';
import { extractPdfText } from './common';

// ---------------------------------------------------------------------------
// Content fingerprints
// ---------------------------------------------------------------------------

const IBKR_MARKERS = [
  'Activity Statement',
  'Mark-to-Market Performance Summary',
  'Realized & Unrealized Performance Summary',
];

const WHT_COUNTRY_CODE: Record<string, string> = {
  US: '840',
  IT: '380',
  FR: '250',
  DE: '276',
  BR: '076',
  JP: '392',
  SE: '752',
  PL: '616',
  GB: '826',
  CA: '124',
  CH: '756',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isinToCountryCode(isin: string): string {
  return resolveCountryCodeFromIsin(isin) ?? '840';
}

function parseIbkrNumber(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

function formatAsset(ticker: string, isin: string): string {
  return isin ? `${ticker} (${isin})` : ticker;
}

function extractIbkrSection(text: string, start: string, ends: string[]): string {
  const lowerText = text.toLowerCase();
  const needle = start.trim().toLowerCase();
  const startIdx = lowerText.indexOf(needle);
  if (startIdx === -1) return '';

  let endIdx = text.length;
  for (const end of ends) {
    const endNeedle = end.trim().toLowerCase();
    const idx = lowerText.indexOf(endNeedle, startIdx + needle.length);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }

  return text.slice(startIdx, endIdx);
}

function findIbkrSectionByRegex(text: string, startPattern: RegExp, ends: string[]): string {
  const startMatch = startPattern.exec(text);
  if (!startMatch) return '';
  const startIdx = startMatch.index;

  const lowerText = text.toLowerCase();
  let endIdx = text.length;
  for (const end of ends) {
    const endNeedle = end.trim().toLowerCase();
    const idx = lowerText.indexOf(endNeedle, startIdx + startMatch[0].length);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }

  return text.slice(startIdx, endIdx);
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface IbkrBuyLot {
  date: string;
  remainingQty: number;
}

interface IbkrSellTrade {
  symbol: string;
  date: string;
  qty: number;
  proceeds: number;
  commFee: number;
  basis: number;
}

interface IbkrDividend {
  date: string;
  ticker: string;
  isin: string;
  amount: number;
}

interface IbkrWhtEntry {
  date: string;
  ticker: string;
  isin: string;
  countryCode: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// FIFO matching
// ---------------------------------------------------------------------------

function buildIbkrRows92A(
  buyPool: Record<string, IbkrBuyLot[]>,
  sellTrades: IbkrSellTrade[],
  instrumentMap: Map<string, string>,
): TaxRow[] {
  const rows: TaxRow[] = [];

  for (const sell of sellTrades) {
    const pool = buyPool[sell.symbol] ?? [];
    let remainingSellQty = sell.qty;

    while (remainingSellQty > 0 && pool.length > 0) {
      const buyEntry = pool[0];
      if (buyEntry.remainingQty <= 0) {
        pool.shift();
        continue;
      }

      const matchedQty = Math.min(buyEntry.remainingQty, remainingSellQty);
      const proportion = matchedQty / sell.qty;

      const valorRealizacao = Math.abs(sell.proceeds) * proportion;
      const valorAquisicao = Math.abs(sell.basis) * proportion;
      const despesasEncargos = Math.abs(sell.commFee) * proportion;

      const sellParts = sell.date.split('-');
      const buyParts = buyEntry.date.split('-');
      const isin = instrumentMap.get(sell.symbol) ?? '';
      const countryCode = isinToCountryCode(isin);

      rows.push({
        codPais: countryCode,
        codigo: 'G20',
        anoRealizacao: sellParts[0],
        mesRealizacao: String(parseInt(sellParts[1], 10)),
        diaRealizacao: String(parseInt(sellParts[2], 10)),
        valorRealizacao: valorRealizacao.toFixed(2),
        anoAquisicao: buyParts[0],
        mesAquisicao: String(parseInt(buyParts[1], 10)),
        diaAquisicao: String(parseInt(buyParts[2], 10)),
        valorAquisicao: valorAquisicao.toFixed(2),
        despesasEncargos: despesasEncargos.toFixed(2),
        impostoPagoNoEstrangeiro: '0.00',
        codPaisContraparte: countryCode,
        _asset: formatAsset(sell.symbol, isin),
      });

      buyEntry.remainingQty -= matchedQty;
      remainingSellQty -= matchedQty;
      if (buyEntry.remainingQty <= 0) pool.shift();
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseIbkrPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  // --- Validate fingerprint ---
  const allMarkersPresent = IBKR_MARKERS.every(m => fullText.includes(m));
  if (!allMarkersPresent) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be an IBKR Activity Statement.`,
      'parser.error.ibkr_wrongFile',
      { fileName: file.name },
    );
  }

  // ---------------------------------------------------------------------------
  // Step A: Build instrument map (ticker → ISIN)
  // ---------------------------------------------------------------------------
  const fiiSection = extractIbkrSection(fullText, 'Financial Instrument Information', ['Trades', 'Dividends', 'Open Positions', 'Net Asset Value']);
  const fiiHeaderEnd = /\bCode\s+/i.exec(fiiSection);
  const fiiData = fiiHeaderEnd ? fiiSection.slice(fiiHeaderEnd.index + fiiHeaderEnd[0].length) : fiiSection;

  const instrumentMap = new Map<string, string>();
  const isinPattern = /([A-Z]{2}[A-Z0-9]{9}\d)/g;
  let fiiMatch: RegExpExecArray | null;
  while ((fiiMatch = isinPattern.exec(fiiData)) !== null) {
    const isin = fiiMatch[1];
    const chunk = fiiData.substring(Math.max(0, fiiMatch.index - 300), fiiMatch.index).trim();
    const afterLastType = chunk.split(/\b(?:COMMON|ADR|ETF|REIT|FUND|PREFERRED|BOND|NOTE|RIGHT|WARRANT)\b/i).pop() ?? chunk;
    const tickerMatch = afterLastType.trim().match(/^([A-Z0-9][A-Z0-9.]{0,10})\b/);
    if (tickerMatch && !/^\d+$/.test(tickerMatch[1])) {
      if (!instrumentMap.has(tickerMatch[1])) {
        instrumentMap.set(tickerMatch[1], isin);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step B: Extract stock trades → rows92A (FIFO buy/sell matching)
  // ---------------------------------------------------------------------------
  const tradesSection = findIbkrSectionByRegex(
    fullText,
    /Trades\s+Symbol\s+Date\/Time/i,
    ['Corporate Actions']
  );
  const stocksText = extractIbkrSection(tradesSection, 'Stocks', ['Equity and Index Options', 'CFDs', 'Forex']);

  const tradeRowRegex = /\b([A-Z0-9][A-Z0-9.]{0,15})\s+(\d{4}-\d{2}-\d{2}),\s*\d{2}:\d{2}:\d{2}\s+([-\d,.]+)\s+[\d,.]+\s+[\d,.]+\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,.]+)\s+[-\d,.]+\s+[-\d,.]+\s+(\S+)/g;

  const buyPool: Record<string, IbkrBuyLot[]> = {};
  const sellTrades: IbkrSellTrade[] = [];

  let tradeMatch: RegExpExecArray | null;
  while ((tradeMatch = tradeRowRegex.exec(stocksText)) !== null) {
    const symbol = tradeMatch[1];
    const date = tradeMatch[2];
    const qty = parseIbkrNumber(tradeMatch[3]);
    const proceeds = parseIbkrNumber(tradeMatch[4]);
    const commFee = parseIbkrNumber(tradeMatch[5]);
    const basis = parseIbkrNumber(tradeMatch[6]);

    if (qty > 0) {
      if (!buyPool[symbol]) buyPool[symbol] = [];
      buyPool[symbol].push({ date, remainingQty: qty });
    } else if (qty < 0) {
      sellTrades.push({ symbol, date, qty: Math.abs(qty), proceeds, commFee, basis });
    }
  }

  for (const symbol of Object.keys(buyPool)) {
    buyPool[symbol].sort((a, b) => a.date.localeCompare(b.date));
  }

  const rows92A = buildIbkrRows92A(buyPool, sellTrades, instrumentMap);

  // ---------------------------------------------------------------------------
  // Step C: Extract dividends + WHT → rows8A (E11)
  // ---------------------------------------------------------------------------
  const dividendsText = findIbkrSectionByRegex(
    fullText,
    /Dividends\s+Date\s+Description/i,
    ['Change in Dividend Accruals', 'Deposits']
  );
  const whtText = findIbkrSectionByRegex(
    fullText,
    /Withholding\s+Tax\s+Date\s+Description/i,
    ['Fees', 'Interest']
  );

  const dividendRegex = /(\d{4}-\d{2}-\d{2})\s+([A-Z][A-Z0-9.]*)\(([A-Z]{2}[A-Z0-9]{9}\d)\)\s+[\s\S]+?\s+([\d,.]+)(?=\s+(?:\d{4}-\d{2}-\d{2}|Total\s))/g;
  const dividends: IbkrDividend[] = [];

  let divMatch: RegExpExecArray | null;
  while ((divMatch = dividendRegex.exec(dividendsText)) !== null) {
    dividends.push({
      date: divMatch[1],
      ticker: divMatch[2],
      isin: divMatch[3],
      amount: parseIbkrNumber(divMatch[4]),
    });
  }

  const whtRegex = /(\d{4}-\d{2}-\d{2})\s+([A-Z][A-Z0-9.]*)\(([A-Z]{2}[A-Z0-9]{9}\d)\)\s+[\s\S]+?-\s*([A-Z]{2})\s+Tax\s+([-\d,.]+)/g;
  const whtEntries: IbkrWhtEntry[] = [];

  let whtMatch: RegExpExecArray | null;
  while ((whtMatch = whtRegex.exec(whtText)) !== null) {
    whtEntries.push({
      date: whtMatch[1],
      ticker: whtMatch[2],
      isin: whtMatch[3],
      countryCode: WHT_COUNTRY_CODE[whtMatch[4]] ?? isinToCountryCode(whtMatch[3]),
      amount: Math.abs(parseIbkrNumber(whtMatch[5])),
    });
  }

  const divAggMap = new Map<string, { rendimentoBruto: number; impostoPago: number; codPais: string; asset: string }>();
  for (const div of dividends) {
    const whtEntry = whtEntries.find(w => w.ticker === div.ticker && w.date === div.date);
    const countryCode = whtEntry ? whtEntry.countryCode : isinToCountryCode(div.isin);
    const key = `${div.ticker}:${countryCode}`;
    const existing = divAggMap.get(key);
    if (existing) {
      existing.rendimentoBruto += div.amount;
      existing.impostoPago += whtEntry?.amount ?? 0;
    } else {
      divAggMap.set(key, {
        rendimentoBruto: div.amount,
        impostoPago: whtEntry?.amount ?? 0,
        codPais: countryCode,
        asset: formatAsset(div.ticker, div.isin),
      });
    }
  }

  const rows8A: TaxRow8A[] = [];
  for (const [, entry] of divAggMap) {
    rows8A.push({
      codigo: 'E11',
      codPais: entry.codPais,
      rendimentoBruto: entry.rendimentoBruto.toFixed(2),
      impostoPago: entry.impostoPago.toFixed(2),
      _asset: entry.asset,
    });
  }

  // ---------------------------------------------------------------------------
  // Step D: Extract credit interest → rows8A (E21, Ireland 372)
  // ---------------------------------------------------------------------------
  const interestText = findIbkrSectionByRegex(
    fullText,
    /Interest\s+Date\s+Description/i,
    ['Dividends', 'Deposits']
  );

  const creditInterestRegex = /(?:Credit Interest|IBKR Managed Securities \(SYEP\) Interest)\s+for\s+\S+\s+([\d,.]+)/g;
  let totalInterest = 0;
  let interestLineMatch: RegExpExecArray | null;
  while ((interestLineMatch = creditInterestRegex.exec(interestText)) !== null) {
    totalInterest += parseIbkrNumber(interestLineMatch[1]);
  }

  const interestWhtRegex = /Withholding\s+@\s+\d+%\s+on\s+Credit\s+Interest\s+for\s+\S+\s+([-\d,.]+)/g;
  let totalInterestWht = 0;
  let interestWhtLineMatch: RegExpExecArray | null;
  while ((interestWhtLineMatch = interestWhtRegex.exec(whtText)) !== null) {
    totalInterestWht += Math.abs(parseIbkrNumber(interestWhtLineMatch[1]));
  }

  if (totalInterest > 0) {
    rows8A.push({
      codigo: 'E21',
      codPais: '372',
      rendimentoBruto: totalInterest.toFixed(2),
      impostoPago: totalInterestWht.toFixed(2),
    });
  }

  // ---------------------------------------------------------------------------
  // Step E: Extract options realized P/L → rowsG13 (G51, US 840)
  // ---------------------------------------------------------------------------
  const optionsText = extractIbkrSection(tradesSection, 'Equity and Index Options', ['CFDs', 'Forex']);

  const derivativeRealizedPLRegex = /(\d{4}-\d{2}-\d{2}),\s*\d{2}:\d{2}:\d{2}\s+[-\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[-\d,.]+\s+[-\d,.]+\s+[-\d,.]+\s+([-\d,.]+)\s+[-\d,.]+\s+(\S+)/g;

  let totalOptionsRealizedPL = 0;
  let optMatch: RegExpExecArray | null;
  while ((optMatch = derivativeRealizedPLRegex.exec(optionsText)) !== null) {
    const realizedPL = parseIbkrNumber(optMatch[2]);
    if (realizedPL !== 0) {
      totalOptionsRealizedPL += realizedPL;
    }
  }

  // ---------------------------------------------------------------------------
  // Step F: Extract CFD realized P/L → rowsG13 (G51, Ireland 372)
  // ---------------------------------------------------------------------------
  const cfdsText = extractIbkrSection(tradesSection, 'CFDs', ['Forex', 'Bonds', 'Warrants']);

  let totalCfdRealizedPL = 0;
  const cfdRealizedPLRegex = new RegExp(derivativeRealizedPLRegex.source, derivativeRealizedPLRegex.flags);
  let cfdMatch: RegExpExecArray | null;
  while ((cfdMatch = cfdRealizedPLRegex.exec(cfdsText)) !== null) {
    const realizedPL = parseIbkrNumber(cfdMatch[2]);
    if (realizedPL !== 0) {
      totalCfdRealizedPL += realizedPL;
    }
  }

  const rowsG13: TaxRowG13[] = [];
  if (totalOptionsRealizedPL !== 0) {
    rowsG13.push({
      codigoOperacao: 'G51',
      titular: 'A',
      rendimentoLiquido: totalOptionsRealizedPL.toFixed(2),
      paisContraparte: '840',
    });
  }
  if (totalCfdRealizedPL !== 0) {
    rowsG13.push({
      codigoOperacao: 'G51',
      titular: 'A',
      rendimentoLiquido: totalCfdRealizedPL.toFixed(2),
      paisContraparte: '372',
    });
  }

  // --- Validate at least something was extracted ---
  const totalRows = rows8A.length + rows92A.length + rowsG13.length;
  if (totalRows === 0) {
    throw new BrokerParsingError(
      `No trades, dividends, or interest data found in "${file.name}". Please verify this is an IBKR Activity Statement.`,
      'parser.error.ibkr_noData',
      { fileName: file.name },
    );
  }

  return {
    rows8A,
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13,
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}

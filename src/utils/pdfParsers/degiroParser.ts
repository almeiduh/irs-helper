import type { ParsedPdfData, TaxRow, TaxRow8A } from '../../types';
import { BrokerParsingError } from '../parserErrors';
import { extractPdfText } from './common';

const DEGIRO_MARKERS = [
  'Relatório Anual',
  'degiro.pt',
  'flatexDEGIRO',
];

const ISO2_TO_COUNTRY_CODE: Record<string, string> = {
  AU: '036',
  AT: '040',
  BE: '056',
  BM: '060',
  BR: '076',
  VG: '092',
  CA: '124',
  KY: '136',
  CN: '156',
  CY: '196',
  DK: '208',
  FI: '246',
  FR: '250',
  DE: '276',
  IL: '376',
  IE: '372',
  IT: '380',
  JP: '392',
  LU: '442',
  NL: '528',
  NO: '578',
  MH: '584',
  PL: '616',
  PT: '620',
  ES: '724',
  SE: '752',
  CH: '756',
  GB: '826',
  JE: '832',
  US: '840',
};

const MONEY_PATTERN = String.raw`-?\d{1,3}(?:\.\d{3})*,\d{2}`;
const DECIMAL_PATTERN = String.raw`-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+,\d{2,6}|-?\d+`;
const FUND_KEYWORDS = ['ETF', 'UCITS', 'FUND', 'SICAV', 'OEIC'];
const BOND_KEYWORDS = ['BOND', 'NOTE', 'DEBT', 'OBLIGA', 'OBRIGACAO'];
const EQUITY_KEYWORDS = ['SHARE', 'SHARES', 'STOCK', 'ORD', 'ORDINARY', 'COMMON', 'ADR', 'ADS'];
const QUANTITY_EPSILON = 0.000001;

interface DegiroPdfTrade {
  product: string;
  isin: string;
  date: string;
  quantity: number;
  valueEur: number;
  feeEur: number;
}

interface OpenLot {
  acquisitionDate: string;
  remainingQuantity: number;
  unitGrossEur: number;
  unitCostEur: number;
}

function emptyParsedData(): ParsedPdfData {
  return {
    rows8A: [],
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}

function parseDegiroMoney(value: string): number {
  return Number.parseFloat(value.replace(/\./g, '').replace(',', '.'));
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatDatePart(value: string): string {
  return String(Number.parseInt(value, 10));
}

function normalizeProduct(product: string): string {
  return product
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function cleanExtractedProduct(product: string): string {
  return product
    .replace(/^.*?Taxa de câmbio\s+/, '')
    .replace(new RegExp(String.raw`^${DECIMAL_PATTERN}\s+`), '')
    .trim();
}

function matchesProductKeyword(product: string, keyword: string): boolean {
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escapedKeyword}([^A-Z0-9]|$)`).test(product);
}

function classifyDegiroProductCode(product: string): string {
  const normalizedProduct = normalizeProduct(product);

  if (FUND_KEYWORDS.some(keyword => matchesProductKeyword(normalizedProduct, keyword))) {
    return 'G20';
  }

  if (BOND_KEYWORDS.some(keyword => matchesProductKeyword(normalizedProduct, keyword))) {
    return 'G10';
  }

  if (EQUITY_KEYWORDS.some(keyword => matchesProductKeyword(normalizedProduct, keyword))) {
    return 'G01';
  }

  throw new Error('ambiguous');
}

function extractSection(text: string, start: string, ends: string[]): string {
  const lowerText = text.toLowerCase();
  const startIdx = lowerText.indexOf(start.toLowerCase());
  if (startIdx === -1) {
    return '';
  }

  let endIdx = text.length;
  for (const end of ends) {
    const idx = lowerText.indexOf(end.toLowerCase(), startIdx + start.length);
    if (idx !== -1 && idx < endIdx) {
      endIdx = idx;
    }
  }

  return text.slice(startIdx, endIdx);
}

function extractDividendRows(fullText: string): TaxRow8A[] {
  const section = extractSection(fullText, 'Dividendos E Outras Remunerações Ao Acionista', [
    'Visão geral sobre os cupões',
    'Transações',
    'Relatório Anual',
  ]);
  if (!section) {
    return [];
  }

  const rows: TaxRow8A[] = [];
  const rowRegex = new RegExp(String.raw`\b([A-Z]{2})\s+(.+?)\s+(${MONEY_PATTERN})\s+EUR\s+(${MONEY_PATTERN})\s+EUR\s+(${MONEY_PATTERN})\s+EUR`, 'g');
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(section)) !== null) {
    const countryCode = ISO2_TO_COUNTRY_CODE[match[1]];
    if (!countryCode) {
      throw new BrokerParsingError(
        `Unsupported DEGIRO dividend country found in "annual report".`,
        'parser.error.degiro_unsupported_country',
        { fileName: 'annual report', isin: match[1] }
      );
    }

    const gross = parseDegiroMoney(match[3]);
    const withholding = parseDegiroMoney(match[4]);
    if (gross === 0 && withholding === 0) {
      continue;
    }

    rows.push({
      codigo: 'E11',
      codPais: countryCode,
      rendimentoBruto: formatMoney(gross),
      impostoPago: formatMoney(withholding),
    });
  }

  return rows;
}

function formatAsset(product: string, isin: string): string {
  return `${product} (${isin})`;
}

function buildTaxRow(countryCode: string, operationCode: string, sell: DegiroPdfTrade, lot: OpenLot, matchedQuantity: number): TaxRow {
  const sellQuantity = Math.abs(sell.quantity);
  const realizationValue = (Math.abs(sell.valueEur) / sellQuantity) * matchedQuantity;
  const acquisitionValue = lot.unitGrossEur * matchedQuantity;
  const expenseValue = (Math.abs(sell.feeEur) / sellQuantity) * matchedQuantity + lot.unitCostEur * matchedQuantity;
  const [sellDay, sellMonth, sellYear] = sell.date.split('-');
  const [buyDay, buyMonth, buyYear] = lot.acquisitionDate.split('-');

  return {
    codPais: countryCode,
    codigo: operationCode,
    anoRealizacao: sellYear,
    mesRealizacao: formatDatePart(sellMonth),
    diaRealizacao: formatDatePart(sellDay),
    valorRealizacao: formatMoney(realizationValue),
    anoAquisicao: buyYear,
    mesAquisicao: formatDatePart(buyMonth),
    diaAquisicao: formatDatePart(buyDay),
    valorAquisicao: formatMoney(acquisitionValue),
    despesasEncargos: formatMoney(expenseValue),
    impostoPagoNoEstrangeiro: '0.00',
    codPaisContraparte: '620',
    _asset: formatAsset(sell.product, sell.isin),
  };
}

function extractTransactionRows(fullText: string, fileName: string): TaxRow[] {
  const section = extractSection(fullText, 'Transações Produto Ticker / ISIN', [
    'Visão geral de transações de criptomoedas',
    'Relatório Anual',
  ]);
  if (!section || section.includes('Não há transações para o ano reportado')) {
    return [];
  }

  const tradeRegex = new RegExp(String.raw`(.+?)\s+([A-Z]{2}[A-Z0-9]{9}\d)\s+(\d{2}-\d{2}-\d{4})\s+(${DECIMAL_PATTERN})\s+(${DECIMAL_PATTERN})\s+[A-Z]{3}\s+(${MONEY_PATTERN})\s+[A-Z]{3}\s+(${MONEY_PATTERN})\s+[A-Z]{3}\s+(?:Compra|Venda|Buy|Sell)\s+(${MONEY_PATTERN})\s+[A-Z]{3}`, 'g');
  const trades: DegiroPdfTrade[] = [];
  let match: RegExpExecArray | null;

  while ((match = tradeRegex.exec(section)) !== null) {
    trades.push({
      product: cleanExtractedProduct(match[1]),
      isin: match[2],
      date: match[3],
      quantity: parseDegiroMoney(match[4]),
      valueEur: parseDegiroMoney(match[7]),
      feeEur: parseDegiroMoney(match[8]),
    });
  }

  const rows: TaxRow[] = [];
  const openLots = new Map<string, OpenLot[]>();

  for (const trade of trades) {
    const countryCode = ISO2_TO_COUNTRY_CODE[trade.isin.slice(0, 2).toUpperCase()];
    if (!countryCode) {
      throw new BrokerParsingError(
        `Unsupported ISIN country found in "${fileName}".`,
        'parser.error.degiro_unsupported_country',
        { fileName, isin: trade.isin }
      );
    }

    const lots = openLots.get(trade.isin) ?? [];
    if (trade.quantity > 0) {
      lots.push({
        acquisitionDate: trade.date,
        remainingQuantity: trade.quantity,
        unitGrossEur: Math.abs(trade.valueEur) / trade.quantity,
        unitCostEur: Math.abs(trade.feeEur) / trade.quantity,
      });
      openLots.set(trade.isin, lots);
      continue;
    }

    let remainingSellQuantity = Math.abs(trade.quantity);
    const operationCode = classifyDegiroProductCode(trade.product);
    while (remainingSellQuantity > QUANTITY_EPSILON && lots.length > 0) {
      const lot = lots[0];
      const matchedQuantity = Math.min(lot.remainingQuantity, remainingSellQuantity);
      rows.push(buildTaxRow(countryCode, operationCode, trade, lot, matchedQuantity));

      lot.remainingQuantity -= matchedQuantity;
      remainingSellQuantity -= matchedQuantity;
      if (lot.remainingQuantity <= QUANTITY_EPSILON) {
        lots.shift();
      }
    }

    if (remainingSellQuantity > QUANTITY_EPSILON) {
      throw new BrokerParsingError(
        `The DEGIRO PDF "${fileName}" is missing buy history required to match a sell transaction.`,
        'parser.error.degiro_incomplete_history',
        { fileName }
      );
    }

    openLots.set(trade.isin, lots);
  }

  return rows;
}

export async function parseDegiroAnnualPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ').replace(/\s+/g, ' ').trim();

  if (!DEGIRO_MARKERS.every(marker => fullText.includes(marker))) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a DEGIRO annual report.`,
      'parser.error.degiro_pdf_wrong_file',
      { fileName: file.name }
    );
  }

  const parsedData = emptyParsedData();
  parsedData.rows8A = extractDividendRows(fullText);
  parsedData.rows92A = extractTransactionRows(fullText, file.name);

  const totalRows = parsedData.rows8A.length + parsedData.rows92A.length + parsedData.rowsG13.length;
  if (totalRows === 0) {
    throw new BrokerParsingError(
      `No dividend, interest, or transaction rows found in "${file.name}". Please verify this is a DEGIRO annual report with taxable events.`,
      'parser.error.degiro_pdf_no_rows',
      { fileName: file.name }
    );
  }

  return parsedData;
}

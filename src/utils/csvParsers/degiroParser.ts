import type { ParsedPdfData, TaxRow } from '../../types';
import { resolveCountryCodeFromIsin } from '../brokerCountries';
import { BrokerParsingError } from '../parserErrors';

const EXPECTED_HEADERS = [
  'Data',
  'Hora',
  'Produto',
  'ISIN',
  'Bolsa de referência',
  'Bolsa',
  'Quantidade',
  'Preços',
  '',
  'Valor local',
  '',
  'Valor EUR',
  'Taxa de Câmbio',
  'Taxa Autofx',
  'Custos de transação e/ou taxas de terceiros',
  'Total EUR',
  'ID da Ordem',
  '',
] as const;

interface CsvTradeRow {
  date: string;
  time: string;
  product: string;
  isin: string;
  quantity: number;
  price: number;
  valueEur: number;
  costEur: number;
  orderId: string;
  sourceIndex: number;
}

interface TradeEvent {
  date: string;
  time: string;
  product: string;
  isin: string;
  quantity: number;
  price: number;
  valueEur: number;
  costEur: number;
  sourceIndex: number;
}

interface OpenLot {
  acquisitionDate: string;
  remainingQuantity: number;
  unitGrossEur: number;
  unitCostEur: number;
}

interface ParseDegiroTransactionsCsvOptions {
  targetRealizationYear?: string;
}

interface ConsumedSellEvent {
  matchedQuantity: number;
  matches: MatchedLot[];
}

interface MatchedLot {
  acquisitionDate: string;
  matchedQuantity: number;
  unitGrossEur: number;
  unitCostEur: number;
}

const QUANTITY_EPSILON = 0.000001;
const DATE_REGEX = /^(\d{2})-(\d{2})-(\d{4})$/;
const TIME_REGEX = /^(\d{2}):(\d{2})$/;
const FUND_KEYWORDS = ['ETF', 'UCITS', 'FUND', 'SICAV', 'OEIC'];
const BOND_KEYWORDS = ['BOND', 'NOTE', 'DEBT', 'OBLIGA', 'OBRIGACAO'];
const EQUITY_KEYWORDS = ['SHARE', 'SHARES', 'STOCK', 'ORD', 'ORDINARY', 'COMMON', 'ADR', 'ADS'];
const UNSUPPORTED_PRODUCT_KEYWORDS = ['CFD', 'OPTION', 'FUTURE', 'WARRANT', 'TURBO', 'CERTIFICATE', 'SWAP'];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      continue;
    }

    if (char !== '\r') {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter(row => row.some(value => value.trim() !== ''));
}

function normalizeDecimal(value: string): number {
  const normalized = value.trim().replace(/\./g, '').replace(/,/g, '.');
  if (normalized === '') {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseRequiredDecimal(value: string | undefined): number {
  if (!value || value.trim() === '') {
    return Number.NaN;
  }

  return normalizeDecimal(value);
}

function parseOptionalDecimal(value: string | undefined): number {
  if (!value || value.trim() === '') {
    return 0;
  }

  return normalizeDecimal(value);
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatDatePart(value: string): string {
  return String(Number.parseInt(value, 10));
}

function buildTimestamp(date: string, time: string): number {
  const [, dayPart, monthPart, yearPart] = date.match(DATE_REGEX) ?? [];
  const [, hourPart, minutePart] = time.match(TIME_REGEX) ?? [];
  const day = Number.parseInt(dayPart, 10);
  const month = Number.parseInt(monthPart, 10);
  const year = Number.parseInt(yearPart, 10);
  const hour = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  return Date.UTC(year, month - 1, day, hour, minute);
}

function isValidDate(date: string): boolean {
  const match = date.match(DATE_REGEX);
  if (!match) {
    return false;
  }

  const [, dayPart, monthPart, yearPart] = match;
  const day = Number.parseInt(dayPart, 10);
  const month = Number.parseInt(monthPart, 10);
  const year = Number.parseInt(yearPart, 10);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function isValidTime(time: string): boolean {
  const match = time.match(TIME_REGEX);
  if (!match) {
    return false;
  }

  const [, hourPart, minutePart] = match;
  const hour = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function normalizeProduct(product: string): string {
  return product
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function matchesProductKeyword(product: string, keyword: string): boolean {
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escapedKeyword}([^A-Z0-9]|$)`).test(product);
}

function classifyDegiroProductCode(product: string): string {
  const normalizedProduct = normalizeProduct(product);

  if (UNSUPPORTED_PRODUCT_KEYWORDS.some(keyword => matchesProductKeyword(normalizedProduct, keyword))) {
    throw new Error('unsupported');
  }

  if (FUND_KEYWORDS.some(keyword => matchesProductKeyword(normalizedProduct, keyword))) {
    return 'G20';
  }

  if (BOND_KEYWORDS.some(keyword => matchesProductKeyword(normalizedProduct, keyword))) {
    return 'G10';
  }

  if (EQUITY_KEYWORDS.some(keyword => matchesProductKeyword(normalizedProduct, keyword))) {
    return 'G01';
  }

  // Fallback to equity (G01) for plain company names (e.g., "EDP SA", "INTEL CORP")
  // that don't match explicit equity keywords but also aren't funds/bonds/derivatives.
  return 'G01';
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPartsPreservingTotal(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  let remainingTotal = values.reduce((total, value) => total + value, 0);
  return values.map((value, index) => {
    const roundedValue = index === values.length - 1 ? roundMoney(remainingTotal) : roundMoney(value);
    remainingTotal -= roundedValue;
    return roundedValue;
  });
}

function validateHeaders(headers: string[], fileName: string): void {
  if (headers.length !== EXPECTED_HEADERS.length) {
    throw new BrokerParsingError(
      `"${fileName}" does not appear to be a supported DEGIRO transactions CSV export.`,
      'parser.error.degiro_wrong_file',
      { fileName }
    );
  }

  const matches = headers.every((header, index) => header.trim() === EXPECTED_HEADERS[index]);
  if (!matches) {
    throw new BrokerParsingError(
      `"${fileName}" does not appear to be a supported DEGIRO transactions CSV export.`,
      'parser.error.degiro_wrong_file',
      { fileName }
    );
  }
}

function parseTradeRows(fileName: string, rows: string[][]): CsvTradeRow[] {
  const parsedRows: CsvTradeRow[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const date = (row[0] ?? '').trim();
    const time = (row[1] ?? '').trim();
    const isin = (row[3] ?? '').trim();
    const quantity = parseRequiredDecimal(row[6] ?? '');
    const price = parseRequiredDecimal(row[7] ?? '');
    const valueEur = parseRequiredDecimal(row[11] ?? '');
    const autoFxEur = parseOptionalDecimal(row[13] ?? '');
    const brokerFeeEur = parseOptionalDecimal(row[14] ?? '');
    const orderId = (row[17] || row[16] || '').trim();
    const costEur = autoFxEur + brokerFeeEur;

    if (!orderId) {
      continue;
    }

    if (
      !date ||
      !time ||
      !isin ||
      quantity === 0 ||
      !isValidDate(date) ||
      !isValidTime(time) ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(price) ||
      !Number.isFinite(valueEur) ||
      !Number.isFinite(autoFxEur) ||
      !Number.isFinite(brokerFeeEur)
    ) {
      throw new BrokerParsingError(
        `Unsupported DEGIRO transaction row found in "${fileName}".`,
        'parser.error.degiro_unsupported_row',
        { fileName }
      );
    }

    parsedRows.push({
      date,
      time,
      product: (row[2] ?? '').trim(),
      isin,
      quantity,
      price,
      valueEur,
      costEur,
      orderId,
      sourceIndex: index,
    });
  }

  return parsedRows;
}

function consolidateTradeEvents(fileName: string, rows: CsvTradeRow[]): TradeEvent[] {
  const grouped = new Map<string, CsvTradeRow[]>();

  for (const row of rows) {
    const key = `${row.orderId}::${row.date}::${row.isin}::${row.price}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  return [...grouped.values()].map(group => {
    const [first] = group;
    const conflictingRow = group.find(row => row.product !== first.product);

    if (conflictingRow) {
      throw new BrokerParsingError(
        `Conflicting DEGIRO transaction rows found in "${fileName}".`,
        'parser.error.degiro_unsupported_row',
        { fileName }
      );
    }

    return {
      date: first.date,
      time: first.time,
      product: first.product,
      isin: first.isin,
      quantity: roundMoney(group.reduce((total, row) => total + row.quantity, 0)),
      price: first.price,
      valueEur: roundMoney(group.reduce((total, row) => total + Math.abs(row.valueEur), 0)),
      costEur: roundMoney(group.reduce((total, row) => total + row.costEur, 0)),
      sourceIndex: Math.min(...group.map(row => row.sourceIndex)),
    };
  }).sort((left, right) => {
    const timeDiff = buildTimestamp(left.date, left.time) - buildTimestamp(right.date, right.time);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return left.sourceIndex - right.sourceIndex;
  });
}

function buildTaxRow(
  countryCode: string,
  operationCode: string,
  sellEvent: TradeEvent,
  acquisitionDate: string,
  roundedRealizationValue: number,
  roundedAcquisitionValue: number,
  roundedExpenseValue: number,
): TaxRow {
  const [sellDay, sellMonth, sellYear] = sellEvent.date.split('-');
  const [buyDay, buyMonth, buyYear] = acquisitionDate.split('-');

  return {
    codPais: countryCode,
    codigo: operationCode,
    anoRealizacao: sellYear,
    mesRealizacao: formatDatePart(sellMonth),
    diaRealizacao: formatDatePart(sellDay),
    valorRealizacao: formatMoney(roundedRealizationValue),
    anoAquisicao: buyYear,
    mesAquisicao: formatDatePart(buyMonth),
    diaAquisicao: formatDatePart(buyDay),
    valorAquisicao: formatMoney(roundedAcquisitionValue),
    despesasEncargos: formatMoney(roundedExpenseValue),
    impostoPagoNoEstrangeiro: '0.00',
    // DEGIRO's transactions CSV does not expose the counterparty residence,
    // so this legacy default is preserved and surfaced as a UI limitation.
    codPaisContraparte: '620',
  };
}

function getEventYear(event: TradeEvent): string {
  return event.date.split('-')[2];
}

function consumeSellEventLots(
  event: TradeEvent,
  lots: OpenLot[],
): ConsumedSellEvent {
  let remainingSellQuantity = Math.abs(event.quantity);
  const matches: MatchedLot[] = [];

  while (remainingSellQuantity > QUANTITY_EPSILON) {
    const openLot = lots[0];
    if (!openLot) {
      break;
    }

    const matchedQuantity = Math.min(remainingSellQuantity, openLot.remainingQuantity);
    matches.push({
      acquisitionDate: openLot.acquisitionDate,
      matchedQuantity,
      unitGrossEur: openLot.unitGrossEur,
      unitCostEur: openLot.unitCostEur,
    });

    openLot.remainingQuantity -= matchedQuantity;
    remainingSellQuantity -= matchedQuantity;

    if (openLot.remainingQuantity <= QUANTITY_EPSILON) {
      lots.shift();
    }
  }

  return {
    matchedQuantity: Math.abs(event.quantity) - remainingSellQuantity,
    matches,
  };
}

function buildTaxRows(countryCode: string, operationCode: string, sellEvent: TradeEvent, matches: MatchedLot[]): TaxRow[] {
  const sellQuantity = Math.abs(sellEvent.quantity);
  const realizationValues = matches.map(match => (sellEvent.valueEur / sellQuantity) * match.matchedQuantity);
  const acquisitionValues = matches.map(match => match.unitGrossEur * match.matchedQuantity);
  const expenseValues = matches.map(match => -(
    (sellEvent.costEur / sellQuantity) * match.matchedQuantity +
    match.unitCostEur * match.matchedQuantity
  ));

  const roundedRealizationValues = roundPartsPreservingTotal(realizationValues);
  const roundedAcquisitionValues = roundPartsPreservingTotal(acquisitionValues);
  const roundedExpenseValues = roundPartsPreservingTotal(expenseValues);

  return matches.map((match, index) => buildTaxRow(
    countryCode,
    operationCode,
    sellEvent,
    match.acquisitionDate,
    roundedRealizationValues[index],
    roundedAcquisitionValues[index],
    roundedExpenseValues[index],
  ));
}

export async function parseDegiroTransactionsCsv(
  file: File,
  options: ParseDegiroTransactionsCsvOptions = {},
): Promise<ParsedPdfData> {
  const rows = parseCsv(await file.text());
  const [headers, ...dataRows] = rows;

  if (!headers || dataRows.length === 0) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a supported DEGIRO transactions CSV export.`,
      'parser.error.degiro_wrong_file',
      { fileName: file.name }
    );
  }

  validateHeaders(headers, file.name);

  const tradeRows = parseTradeRows(file.name, dataRows);
  const events = consolidateTradeEvents(file.name, tradeRows);
  const rows92A: TaxRow[] = [];
  const openLots = new Map<string, OpenLot[]>();
  const hasIncompleteHistory = new Map<string, boolean>();
  const targetRealizationYear = options.targetRealizationYear;

  for (const event of events) {
    const countryCode = resolveCountryCodeFromIsin(event.isin);
    if (!countryCode) {
      throw new BrokerParsingError(
        `Unsupported ISIN country found in "${file.name}".`,
        'parser.error.degiro_unsupported_country',
        { fileName: file.name, isin: event.isin }
      );
    }

    const lots = openLots.get(event.isin) ?? [];
    if (event.quantity > 0) {
      lots.push({
        acquisitionDate: event.date,
        remainingQuantity: event.quantity,
        unitGrossEur: event.valueEur / event.quantity,
        unitCostEur: event.costEur / event.quantity,
      });
      openLots.set(event.isin, lots);
      continue;
    }

    const shouldEmitRows = !targetRealizationYear || getEventYear(event) === targetRealizationYear;
    const sellQuantity = Math.abs(event.quantity);
    if (shouldEmitRows && hasIncompleteHistory.get(event.isin)) {
      throw new BrokerParsingError(
        `The DEGIRO CSV "${file.name}" is missing buy history required to match a sell transaction.`,
        'parser.error.degiro_incomplete_history',
        { fileName: file.name }
      );
    }

    let operationCode = '';
    if (shouldEmitRows) {
      try {
        operationCode = classifyDegiroProductCode(event.product);
      } catch {
        throw new BrokerParsingError(
          `Unsupported DEGIRO transaction row found in "${file.name}".`,
          'parser.error.degiro_unsupported_row',
          { fileName: file.name }
        );
      }
    }

    const consumedSellEvent = consumeSellEventLots(event, lots);
    openLots.set(event.isin, lots);

    if (consumedSellEvent.matchedQuantity + QUANTITY_EPSILON < sellQuantity) {
      if (shouldEmitRows) {
        throw new BrokerParsingError(
          `The DEGIRO CSV "${file.name}" is missing buy history required to match a sell transaction.`,
          'parser.error.degiro_incomplete_history',
          { fileName: file.name }
        );
      }
      hasIncompleteHistory.set(event.isin, true);
      continue;
    }

    if (shouldEmitRows) {
      rows92A.push(...buildTaxRows(countryCode, operationCode, event, consumedSellEvent.matches));
    }
  }

  if (rows92A.length === 0) {
    if (targetRealizationYear) {
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

    throw new BrokerParsingError(
      `No capital gains rows found in "${file.name}". Please verify this is a DEGIRO transactions CSV with sell trades.`,
      'parser.error.degiro_no_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A: [],
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}

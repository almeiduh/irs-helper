import type { ParsedPdfData, TaxRow, TaxRow8A, TaxRowG18A, TaxRowG1q7 } from '../../types';
import { resolveCountryCode, resolveCountryCodeFromIsin } from '../brokerCountries';
import { BrokerParsingError } from '../parserErrors';

interface ParseRevolutConsolidatedCsvOptions {
  targetRealizationYear?: string;
}

interface DateParts {
  year: string;
  month: string;
  day: string;
  date: Date;
}

interface ValuePair {
  realization: number;
  acquisition: number;
}

const REVOLUT_CSV_MARKERS = [
  'Contas-correntes Resumos',
  'Investment Services Resumos',
  'Cripto Resumos',
  'Fundos Monetarios Flexiveis Resumos',
  'Savings Accounts Resumos',
];

const FLEXIBLE_CASH_FUNDS_INTEREST_HEADERS = [
  'Data',
  'Descricao',
  'Juros liquidos',
  'Imposto retido',
  'Outros impostos',
  'Comissoes de servico',
  'Juros liquidos distribuidos e levantados',
];

const INVESTMENT_DIVIDEND_HEADERS = [
  'Data',
  'Descricao e simbolo',
  'ISIN',
  'Pais',
  'Dividendo/rendimento brutos',
  'Impostos retidos',
  'Outros impostos',
  'Comissoes',
  'Dividendo/lucro liquido',
];

const INVESTMENT_SALE_HEADERS = [
  'Data (da venda, da compra)',
  'Descricao, simbolo e ISIN',
  'Pais',
  'Idade das unidades',
  'Units sold',
  'Preco unitario (Data de venda, na Data de compra)',
  'Valor (da venda, da compra)',
  'Ganhos de capital',
  'Impostos retidos',
  'Outros impostos',
  'Comissoes',
];

const CRYPTO_SALE_HEADERS = [
  'Data (da venda, da compra)',
  'Descricao e simbolo',
  'Idade das unidades',
  'Unidades vendidas',
  'Preco unitario (Data de venda, na Data de compra)',
  'Valor (da venda, da compra)',
  'Ganhos de capital',
  'Comissoes',
];

const COMMODITY_SALE_HEADERS = [
  'Data (da venda, da compra)',
  'Nome do Bem',
  'Idade das unidades',
  'Unidades vendidas',
  'Preco unitario (Data de venda, Data de compra)',
  'Valor (da venda, da compra)',
  'Mais-valias',
  'Comissoes',
];

const FUND_KEYWORDS = ['ETF', 'UCITS', 'FUND', 'SICAV', 'OEIC'];
const BOND_KEYWORDS = ['BOND', 'NOTE', 'DEBT', 'OBLIGA', 'OBRIGACAO'];
const REVOLUT_DIGITAL_ASSETS_COUNTRY_CODE = '196';
const DAY_IN_MS = 86_400_000;

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

  return rows;
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cleanCell(value: string | undefined): string {
  return stripDiacritics(value ?? '')
    .replace(/^\ufeff/, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function normalizedCell(value: string | undefined): string {
  return cleanCell(value).replace(/\s+/g, ' ');
}

function normalizedRow(row: string[]): string[] {
  return row.map(normalizedCell);
}

function rowHasContent(row: string[]): boolean {
  return row.some(cell => normalizedCell(cell) !== '');
}

function nonEmptyCells(row: string[]): string[] {
  return normalizedRow(row).filter(Boolean);
}

function parseNumberText(rawValue: string): number {
  const withoutCurrency = rawValue
    .replace(/[€$]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
  const sign = withoutCurrency.replace(/\s/g, '').startsWith('-') ? -1 : 1;
  const numericText = withoutCurrency.replace(/[+\-\s]/g, '').replace(/[,.]+$/, '');

  if (!numericText) {
    return 0;
  }

  const lastComma = numericText.lastIndexOf(',');
  const lastDot = numericText.lastIndexOf('.');
  const normalized = lastComma !== -1 && lastComma > lastDot
    ? numericText.replace(/\./g, '').replace(',', '.')
    : numericText.replace(/,/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? sign * parsed : Number.NaN;
}

function parseEurAmounts(value: string | undefined): number[] {
  const text = normalizedCell(value);
  const matches = text.match(/[+-]?\s*(?:€\s*[\d\s.,]+|[\d\s.,]+€)/g) ?? [];
  return matches
    .map(parseNumberText)
    .filter(Number.isFinite);
}

function parseEurAmount(value: string | undefined): number {
  return Math.abs(parseEurAmounts(value)[0] ?? 0);
}

function parseEurValuePair(value: string | undefined): ValuePair | null {
  const amounts = parseEurAmounts(value).map(Math.abs);
  if (amounts.length < 2) {
    return null;
  }

  return {
    realization: amounts[0],
    acquisition: amounts[1],
  };
}

function formatMoney(value: number): string {
  return (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100).toFixed(2);
}

function normalizeTwoDigitYear(year: number): number {
  if (year < 100) {
    return year >= 70 ? 1900 + year : 2000 + year;
  }
  return year;
}

function parseDate(value: string | undefined): DateParts | null {
  const match = normalizedCell(value).match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = normalizeTwoDigitYear(Number.parseInt(match[3], 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year: String(year),
    month: String(month),
    day: String(day),
    date,
  };
}

function parseDatePair(value: string | undefined): { realizationDate: DateParts; acquisitionDate: DateParts } | null {
  const [realizationRaw, acquisitionRaw] = normalizedCell(value).split(',').map(part => part.trim());
  const realizationDate = parseDate(realizationRaw);
  const acquisitionDate = parseDate(acquisitionRaw);

  if (!realizationDate || !acquisitionDate) {
    return null;
  }

  return { realizationDate, acquisitionDate };
}

function shouldIncludeYear(date: DateParts, targetRealizationYear?: string): boolean {
  return !targetRealizationYear || date.year === targetRealizationYear;
}

function daysBetween(acquisitionDate: Date, realizationDate: Date): number {
  return Math.floor((realizationDate.getTime() - acquisitionDate.getTime()) / DAY_IN_MS);
}

function findHeaderRows(rows: string[][], headers: string[]): number[] {
  const headerRows: number[] = [];
  rows.forEach((row, index) => {
    if (headers.every((header, columnIndex) => normalizedCell(row[columnIndex]) === header)) {
      headerRows.push(index);
    }
  });
  return headerRows;
}

function looksLikeSectionBoundary(row: string[]): boolean {
  const values = nonEmptyCells(row);
  if (values.length === 0) {
    return false;
  }

  const first = values[0];
  return first === '---------' ||
    first === 'Total' ||
    first === 'Acquired' ||
    first.endsWith('Resumos') ||
    first.endsWith('Extratos de operacoes') ||
    first.startsWith('Extrato de operacao') ||
    first.startsWith('Extrato de operacoes') ||
    first.startsWith('Unidades que foram vendidas') ||
    first.startsWith('Outras operacoes de conta de corretagem');
}

function readRowsAfterHeader(rows: string[][], headers: string[]): string[][] {
  const tableRows: string[][] = [];
  for (const headerIndex of findHeaderRows(rows, headers)) {
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!rowHasContent(row)) {
        continue;
      }

      if (looksLikeSectionBoundary(row)) {
        break;
      }

      tableRows.push(row);
    }
  }

  return tableRows;
}

function addWarning(warnings: Set<string>, warningKey: string): void {
  warnings.add(warningKey);
}

function extractIsin(value: string | undefined): string | undefined {
  return normalizedCell(value).match(/[A-Z]{2}[A-Z0-9]{9}\d/)?.[0];
}

function resolveRevolutCountry(country: string | undefined, isin: string | undefined): string {
  const countryCode = country ? resolveCountryCode(normalizedCell(country)) : undefined;
  return countryCode ?? (isin ? resolveCountryCodeFromIsin(isin) : undefined) ?? '840';
}

function matchesKeyword(product: string, keyword: string): boolean {
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escapedKeyword}([^A-Z0-9]|$)`).test(product);
}

function classifyInvestmentProduct(description: string): string {
  const normalizedProduct = normalizedCell(description).toUpperCase();
  if (FUND_KEYWORDS.some(keyword => matchesKeyword(normalizedProduct, keyword))) {
    return 'G20';
  }
  if (BOND_KEYWORDS.some(keyword => matchesKeyword(normalizedProduct, keyword))) {
    return 'G10';
  }
  return 'G01';
}

function parseFlexibleCashFundsInterest(
  rows: string[][],
  targetRealizationYear: string | undefined,
): TaxRow8A[] {
  let grossInterest = 0;
  let taxPaid = 0;

  for (const row of readRowsAfterHeader(rows, FLEXIBLE_CASH_FUNDS_INTEREST_HEADERS)) {
    const date = parseDate(row[0]);
    if (!date || !shouldIncludeYear(date, targetRealizationYear)) {
      continue;
    }

    grossInterest += parseEurAmount(row[2]);
    taxPaid += parseEurAmount(row[3]) + parseEurAmount(row[4]);
  }

  if (grossInterest <= 0 && taxPaid <= 0) {
    return [];
  }

  return [{
    codigo: 'E21',
    codPais: '372',
    rendimentoBruto: formatMoney(grossInterest),
    impostoPago: formatMoney(taxPaid),
  }];
}

function parseInvestmentDividends(
  rows: string[][],
  targetRealizationYear: string | undefined,
): TaxRow8A[] {
  const dividendRows: TaxRow8A[] = [];

  for (const row of readRowsAfterHeader(rows, INVESTMENT_DIVIDEND_HEADERS)) {
    const date = parseDate(row[0]);
    if (!date || !shouldIncludeYear(date, targetRealizationYear)) {
      continue;
    }

    const isin = extractIsin(row[2]);
    const gross = parseEurAmount(row[4]);
    const taxPaid = parseEurAmount(row[5]) + parseEurAmount(row[6]);
    if (gross <= 0 && taxPaid <= 0) {
      continue;
    }

    dividendRows.push({
      codigo: 'E11',
      codPais: resolveRevolutCountry(row[3], isin),
      rendimentoBruto: formatMoney(gross),
      impostoPago: formatMoney(taxPaid),
    });
  }

  return dividendRows;
}

function parseInvestmentSales(
  rows: string[][],
  targetRealizationYear: string | undefined,
  warnings: Set<string>,
): TaxRow[] {
  const saleRows: TaxRow[] = [];

  for (const row of readRowsAfterHeader(rows, INVESTMENT_SALE_HEADERS)) {
    const datePair = parseDatePair(row[0]);
    if (!datePair) {
      addWarning(warnings, 'parser.warning.revolut_csv_unsupported_rows');
      continue;
    }
    if (!shouldIncludeYear(datePair.realizationDate, targetRealizationYear)) {
      continue;
    }

    const values = parseEurValuePair(row[6]);
    const isin = extractIsin(row[1]);
    if (!values || !isin) {
      addWarning(warnings, 'parser.warning.revolut_csv_unsupported_rows');
      continue;
    }

    const countryCode = resolveRevolutCountry(row[2], isin);
    saleRows.push({
      codPais: countryCode,
      codigo: classifyInvestmentProduct(row[1] ?? ''),
      anoRealizacao: datePair.realizationDate.year,
      mesRealizacao: datePair.realizationDate.month,
      diaRealizacao: datePair.realizationDate.day,
      valorRealizacao: formatMoney(values.realization),
      anoAquisicao: datePair.acquisitionDate.year,
      mesAquisicao: datePair.acquisitionDate.month,
      diaAquisicao: datePair.acquisitionDate.day,
      valorAquisicao: formatMoney(values.acquisition),
      despesasEncargos: formatMoney(parseEurAmount(row[9]) + parseEurAmount(row[10])),
      impostoPagoNoEstrangeiro: formatMoney(parseEurAmount(row[8])),
      codPaisContraparte: countryCode,
    });
  }

  return saleRows;
}

function parseCryptoSales(
  rows: string[][],
  targetRealizationYear: string | undefined,
  warnings: Set<string>,
): { rowsG18A: TaxRowG18A[]; rowsG1q7: TaxRowG1q7[] } {
  const rowsG18A: TaxRowG18A[] = [];
  const rowsG1q7: TaxRowG1q7[] = [];

  for (const row of readRowsAfterHeader(rows, CRYPTO_SALE_HEADERS)) {
    const datePair = parseDatePair(row[0]);
    if (!datePair) {
      addWarning(warnings, 'parser.warning.revolut_csv_unsupported_rows');
      continue;
    }
    if (!shouldIncludeYear(datePair.realizationDate, targetRealizationYear)) {
      continue;
    }

    const values = parseEurValuePair(row[5]);
    if (!values) {
      addWarning(warnings, 'parser.warning.revolut_csv_unsupported_rows');
      continue;
    }

    const rowData = {
      titular: 'A',
      codPaisEntGestora: REVOLUT_DIGITAL_ASSETS_COUNTRY_CODE,
      anoRealizacao: datePair.realizationDate.year,
      mesRealizacao: datePair.realizationDate.month,
      diaRealizacao: datePair.realizationDate.day,
      valorRealizacao: formatMoney(values.realization),
      anoAquisicao: datePair.acquisitionDate.year,
      mesAquisicao: datePair.acquisitionDate.month,
      diaAquisicao: datePair.acquisitionDate.day,
      valorAquisicao: formatMoney(values.acquisition),
      despesasEncargos: formatMoney(parseEurAmount(row[7])),
      codPaisContraparte: REVOLUT_DIGITAL_ASSETS_COUNTRY_CODE,
    };

    if (daysBetween(datePair.acquisitionDate.date, datePair.realizationDate.date) >= 365) {
      rowsG1q7.push(rowData);
    } else {
      rowsG18A.push(rowData);
    }
  }

  return { rowsG18A, rowsG1q7 };
}

function hasNonEmptyCommoditySales(rows: string[][]): boolean {
  return readRowsAfterHeader(rows, COMMODITY_SALE_HEADERS).length > 0;
}

function looksLikeRevolutCsv(rows: string[][]): boolean {
  const fullText = rows.map(row => normalizedRow(row).join(' ')).join('\n');
  return REVOLUT_CSV_MARKERS.some(marker => fullText.includes(marker));
}

export async function parseRevolutConsolidatedCsv(
  file: File,
  options: ParseRevolutConsolidatedCsvOptions = {},
): Promise<ParsedPdfData> {
  const rows = parseCsv(await file.text());
  if (!looksLikeRevolutCsv(rows)) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a Revolut Consolidated Statement. Please upload the correct file.`,
      'parser.error.revolut_wrong_file',
      { fileName: file.name },
    );
  }

  const warnings = new Set<string>();
  const rows8A = [
    ...parseFlexibleCashFundsInterest(rows, options.targetRealizationYear),
    ...parseInvestmentDividends(rows, options.targetRealizationYear),
  ];
  const rows92A = parseInvestmentSales(rows, options.targetRealizationYear, warnings);
  const cryptoRows = parseCryptoSales(rows, options.targetRealizationYear, warnings);

  if (hasNonEmptyCommoditySales(rows)) {
    addWarning(warnings, 'parser.warning.revolut_csv_commodities_unsupported');
  }

  return {
    rows8A,
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: cryptoRows.rowsG18A,
    rowsG1q7: cryptoRows.rowsG1q7,
    warnings: [...warnings],
  };
}

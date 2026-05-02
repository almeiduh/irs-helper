import { read, SSF, utils } from 'xlsx';
import type { ParsedPdfData, TaxRow } from '../../types';
import { BrokerParsingError } from '../parserErrors';
import { convertUsdAmountToEur, EcbFxError, getUsdEurRatesForDates } from '../ecbFxRates';

const EXPECTED_HEADERS = [
  'Record Type',
  'Symbol',
  'Plan Type',
  'Quantity',
  'Date Acquired',
  'Date Acquired (Wash Sale Toggle = On)',
  'Acquisition Cost',
  'Acquisition Cost Per Share',
  'Ordinary Income Recognized',
  'Ordinary Income Recognized Per Share',
  'Adjusted Cost Basis',
  'Adjusted Cost Basis Per Share',
  'Date Sold',
  'Total Proceeds',
  'Proceeds Per Share',
  'Deferred Loss',
  'Gain/Loss',
  'Gain/Loss (Wash Sale Toggle = On)',
  'Adjusted Gain/Loss',
  'Adjusted Gain (Loss) Per Share',
  'Capital Gains Status',
  'Wash Sale Adjusted Capital Gains Status',
  'Total Wash Sale Adjustment Amount',
  'Wash Sale Adjustment Amount Per Share',
  'Total Wash Sale Adjusted Cost Basis',
  'Wash Sale Adjusted Cost Basis Per Share',
  'Total Wash Sale Adjusted Gain/Loss',
  'Wash Sale Adjusted Gain/Loss Per Share',
] as const;

const ETRADE_SECURITY_COUNTRY_CODE = '840';
const ETRADE_CAPITAL_GAINS_CODE = 'G01';
const DEFAULT_COUNTERPARTY_COUNTRY_CODE = '620';
const ZERO_MONEY = '0.00';

interface ParseEtradeGainLossWorkbookOptions {
  targetRealizationYear?: string;
}

interface ParsedDate {
  isoDate: string;
  year: string;
  month: string;
  day: string;
}

interface SellRow {
  acquisitionDate: ParsedDate;
  soldDate: ParsedDate;
  adjustedCostBasisUsd: number;
  totalProceedsUsd: number;
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

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatDatePart(value: number): string {
  return String(value);
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (normalized === '') {
    return Number.NaN;
  }

  return Number.parseFloat(normalized);
}

function validateHeaders(headers: unknown[], fileName: string): void {
  const trimmedHeaders = headers.map(header => String(header ?? '').trim());
  if (trimmedHeaders.length !== EXPECTED_HEADERS.length) {
    throw new BrokerParsingError(
      `"${fileName}" does not appear to be a supported E*TRADE gain/loss workbook export.`,
      'parser.error.etrade_wrong_file',
      { fileName },
    );
  }

  const matches = trimmedHeaders.every((header, index) => header === EXPECTED_HEADERS[index]);
  if (!matches) {
    throw new BrokerParsingError(
      `"${fileName}" does not appear to be a supported E*TRADE gain/loss workbook export.`,
      'parser.error.etrade_wrong_file',
      { fileName },
    );
  }
}

function parseDateCell(value: unknown, fileName: string, fieldName: string): ParsedDate {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth() + 1;
    const day = value.getUTCDate();
    return {
      isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      year: String(year),
      month: formatDatePart(month),
      day: formatDatePart(day),
    };
  }

  if (typeof value === 'number') {
    const dateCode = SSF.parse_date_code(value);
    if (dateCode) {
      return {
        isoDate: `${dateCode.y}-${String(dateCode.m).padStart(2, '0')}-${String(dateCode.d).padStart(2, '0')}`,
        year: String(dateCode.y),
        month: formatDatePart(dateCode.m),
        day: formatDatePart(dateCode.d),
      };
    }
  }

  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) {
    throw new BrokerParsingError(
      `Unsupported E*TRADE date value "${raw}" found in "${fileName}".`,
      'parser.error.etrade_unsupported_row',
      { fileName, fieldName },
    );
  }

  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  const year = match[3].length === 2 ? 2000 + Number.parseInt(match[3], 10) : Number.parseInt(match[3], 10);

  return {
    isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    year: String(year),
    month: formatDatePart(month),
    day: formatDatePart(day),
  };
}

function parseSellRows(fileName: string, rows: unknown[][]): SellRow[] {
  const sellRows: SellRow[] = [];

  for (const row of rows) {
    const recordType = String(row[0] ?? '').trim();
    if (!recordType) {
      continue;
    }

    if (recordType === 'Summary') {
      continue;
    }

    if (recordType !== 'Sell') {
      throw new BrokerParsingError(
        `Unsupported E*TRADE row type "${recordType}" found in "${fileName}".`,
        'parser.error.etrade_unsupported_row',
        { fileName, fieldName: 'Record Type' },
      );
    }

    const symbol = String(row[1] ?? '').trim();
    const quantity = normalizeNumber(row[3]);
    const acquisitionDate = parseDateCell(row[4], fileName, 'Date Acquired');
    const soldDate = parseDateCell(row[12], fileName, 'Date Sold');
    const adjustedCostBasisUsd = normalizeNumber(row[10]);
    const totalProceedsUsd = normalizeNumber(row[13]);
    const adjustedGainLossRaw = String(row[18] ?? '').trim();
    const adjustedGainLossUsd = adjustedGainLossRaw ? normalizeNumber(row[18]) : undefined;

    if (
      !symbol ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(adjustedCostBasisUsd) ||
      !Number.isFinite(totalProceedsUsd) ||
      (adjustedGainLossRaw !== '' && !Number.isFinite(adjustedGainLossUsd))
    ) {
      throw new BrokerParsingError(
        `Unsupported E*TRADE transaction row found in "${fileName}".`,
        'parser.error.etrade_unsupported_row',
        { fileName, fieldName: 'Sell row' },
      );
    }

    if (
      typeof adjustedGainLossUsd === 'number' &&
      Math.abs((totalProceedsUsd - adjustedCostBasisUsd) - adjustedGainLossUsd) > 0.05
    ) {
      throw new BrokerParsingError(
        `Inconsistent adjusted gain/loss found in "${fileName}".`,
        'parser.error.etrade_unsupported_row',
        { fileName, fieldName: 'Adjusted Gain/Loss' },
      );
    }

    sellRows.push({
      acquisitionDate,
      soldDate,
      adjustedCostBasisUsd,
      totalProceedsUsd,
    });
  }

  return sellRows;
}

function buildTaxRow(row: SellRow, rates: Record<string, number>): TaxRow {
  return {
    codPais: ETRADE_SECURITY_COUNTRY_CODE,
    codigo: ETRADE_CAPITAL_GAINS_CODE,
    anoRealizacao: row.soldDate.year,
    mesRealizacao: row.soldDate.month,
    diaRealizacao: row.soldDate.day,
    valorRealizacao: formatMoney(convertUsdAmountToEur(row.totalProceedsUsd, rates[row.soldDate.isoDate])),
    anoAquisicao: row.acquisitionDate.year,
    mesAquisicao: row.acquisitionDate.month,
    diaAquisicao: row.acquisitionDate.day,
    valorAquisicao: formatMoney(convertUsdAmountToEur(row.adjustedCostBasisUsd, rates[row.acquisitionDate.isoDate])),
    despesasEncargos: ZERO_MONEY,
    impostoPagoNoEstrangeiro: ZERO_MONEY,
    codPaisContraparte: DEFAULT_COUNTERPARTY_COUNTRY_CODE,
  };
}

export async function parseEtradeGainLossWorkbook(
  file: File,
  options: ParseEtradeGainLossWorkbookOptions = {},
): Promise<ParsedPdfData> {
  const workbook = read(await file.arrayBuffer(), {
    type: 'array',
    cellDates: true,
  });
  const [firstSheetName] = workbook.SheetNames;
  const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!firstSheet) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a supported E*TRADE gain/loss workbook export.`,
      'parser.error.etrade_wrong_file',
      { fileName: file.name },
    );
  }

  const rows = utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: true,
    defval: '',
  });
  const [headers, ...bodyRows] = rows;
  if (!headers || bodyRows.length === 0) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a supported E*TRADE gain/loss workbook export.`,
      'parser.error.etrade_wrong_file',
      { fileName: file.name },
    );
  }

  validateHeaders(headers, file.name);
  const sellRows = parseSellRows(file.name, bodyRows);
  const filteredRows = options.targetRealizationYear
    ? sellRows.filter(row => row.soldDate.year === options.targetRealizationYear)
    : sellRows;

  if (filteredRows.length === 0) {
    if (options.targetRealizationYear) {
      return emptyParsedData();
    }

    throw new BrokerParsingError(
      `No supported E*TRADE sell rows found in "${file.name}".`,
      'parser.error.etrade_no_rows',
      { fileName: file.name },
    );
  }

  const requiredDates = filteredRows.flatMap(row => [row.acquisitionDate.isoDate, row.soldDate.isoDate]);

  try {
    const rates = await getUsdEurRatesForDates(requiredDates);
    return {
      rows8A: [],
      rows92A: filteredRows.map(row => buildTaxRow(row, rates)),
      rows92B: [],
      rowsG9: [],
      rowsG13: [],
      rowsG18A: [],
      rowsG1q7: [],
      warnings: [],
    };
  } catch (error) {
    if (error instanceof EcbFxError && error.code === 'missing_rate') {
      throw new BrokerParsingError(
        `The E*TRADE workbook "${file.name}" requires an ECB USD/EUR rate for ${error.date}.`,
        'parser.error.etrade_missing_fx_rate',
        { fileName: file.name, date: error.date ?? '' },
      );
    }

    if (error instanceof EcbFxError) {
      throw new BrokerParsingError(
        `Failed to download ECB USD/EUR rates while processing "${file.name}".`,
        'parser.error.etrade_fx_download_failed',
        { fileName: file.name },
      );
    }

    throw error;
  }
}

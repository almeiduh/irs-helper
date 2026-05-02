import type { TaxRow, TaxRow8A, ParsedPdfData } from '../../types';
import { BrokerParsingError } from '../parserErrors';
import { normalizeNumber, extractPdfText, extractRows, matchesAnyMarker } from './common';

// ---------------------------------------------------------------------------
// Regex patterns (shared with XTB for TR's IRS-formatted layout)
// ---------------------------------------------------------------------------

const REGEX_8A = /(?:^|\s)\d{3}\s+(E\d{2})\s*(?:\(\d+%?\))?\s+(\d{3})\s+([\d.,-]+)\s+([\d.,-]+)(?=\s|$)/g;
const MONEY_VALUE = String.raw`-?\d(?:[\d\s\u00a0.]*\d)?[,.]\d+`;
const REGEX_92A = new RegExp(
  String.raw`(?:^|\s)\d{3,}\s+(\d{3})\s+(G\d{2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(${MONEY_VALUE})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(${MONEY_VALUE})\s+(${MONEY_VALUE})\s+(${MONEY_VALUE})\s+(\d{3})(?=\s|$|[A-Za-zÀ-ÿ])`,
  'g',
);

// ---------------------------------------------------------------------------
// Content fingerprints
// ---------------------------------------------------------------------------

const TR_REPORT_MARKERS = [
  /Trade\s*Republic/i,
  /Steuerübersicht/i,
  /Tax\s*Report/i,
  /Relatório\s*(?:de\s*)?Impost/i,
];

// ---------------------------------------------------------------------------
// Row extractors
// ---------------------------------------------------------------------------

function extractRows8A(pageTexts: string[]): TaxRow8A[] {
  return extractRows(pageTexts, REGEX_8A, match => ({
    codigo: match[1],
    codPais: match[2],
    rendimentoBruto: normalizeNumber(match[3]),
    impostoPago: normalizeNumber(match[4]),
  }));
}

function normalizeMoney(value: string): string {
  const compact = value.replace(/[\s\u00a0]/g, '');
  if (compact.includes(',')) {
    return compact.replace(/\./g, '').replace(',', '.');
  }

  return compact;
}

function extractRows92A(pageTexts: string[]): TaxRow[] {
  return extractRows(pageTexts, REGEX_92A, match => ({
    codPais: match[1],
    codigo: match[2],
    anoRealizacao: match[3],
    mesRealizacao: match[4],
    diaRealizacao: match[5],
    valorRealizacao: normalizeMoney(match[6]),
    anoAquisicao: match[7],
    mesAquisicao: match[8],
    diaAquisicao: match[9],
    valorAquisicao: normalizeMoney(match[10]),
    despesasEncargos: normalizeMoney(match[11]),
    impostoPagoNoEstrangeiro: normalizeMoney(match[12]),
    codPaisContraparte: match[13],
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseTradeRepublicPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  const looksLikeTR = matchesAnyMarker(fullText, TR_REPORT_MARKERS);

  if (!looksLikeTR) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a Trade Republic Tax Report. Please upload the correct file.`,
      'parser.error.tr_wrong_file',
      { fileName: file.name }
    );
  }

  const rows8A = extractRows8A(pageTexts);
  const rows92A = extractRows92A(pageTexts);

  if (rows8A.length === 0 && rows92A.length === 0) {
    throw new BrokerParsingError(
      `No dividend/interest or capital gains rows found in "${file.name}". Please verify this is a Trade Republic Tax Report with Quadro 8A or 9.2A data.`,
      'parser.error.tr_no_rows',
      { fileName: file.name }
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

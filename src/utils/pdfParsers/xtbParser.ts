import type { TaxRow, TaxRow92B, TaxRow8A, TaxRowG13, ParsedPdfData } from '../../types';
import { BrokerParsingError } from '../parserErrors';
import { normalizeNumber, extractPdfText, extractRows, matchesAnyMarker } from './common';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const REGEX_8A = /(?:^|\s)\d{3}\s+(E\d{2})\s*(?:\(\d+%?\))?\s+(\d{3})\s+([\d.,-]+)\s+([\d.,-]+)(?=\s|$)/g;

const REGEX_92A = /(?:^|\s)\d{3,}\s+(\d{3})\s+(G\d{2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s+(\d{3})\s+(SIM|S|NAO|N(?:[ÃA]O)?)(?=\s|$)/gi;

const REGEX_92B = /(?:^|\s)\d{3,}\s+(G\d{2})\s+(\d{3})\s+([\d.,-]+)\s+([\d.,-]+)\s+(\d{3})(?=\s|$)/g;

const REGEX_G13 = /(?:^|\s)\d{5}\s+(G\d{2})\s+([AB])\s+(-?[\d.,-]+)\s+(\d{3})(?=\s|$)/g;

// ---------------------------------------------------------------------------
// Content fingerprints
// ---------------------------------------------------------------------------

const XTB_GAINS_MARKERS = [
  /Quadro\s*9\.?2\s*A/i,
  /9\.2\s*A\s*-?\s*(?:Aliena|Venda)/i,
  /AnexoJ.*Quadro\s*0?9/i,
  /Mais[- ]?[Vv]alias/i,
  /Capital\s*Gains/i,
];

const XTB_DIVIDENDS_MARKERS = [
  /Quadro\s*8\s*A/i,
  /8\s*A\s*-?\s*Divid/i,
  /Dividendos/i,
  /Dividend/i,
  /AnexoJ.*Quadro\s*0?8/i,
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

function extractRows92A(pageTexts: string[]): TaxRow[] {
  return extractRows(pageTexts, REGEX_92A, match => ({
    codPais: match[1],
    codigo: match[2],
    anoRealizacao: match[3],
    mesRealizacao: match[4],
    diaRealizacao: match[5],
    valorRealizacao: normalizeNumber(match[6]),
    anoAquisicao: match[7],
    mesAquisicao: match[8],
    diaAquisicao: match[9],
    valorAquisicao: normalizeNumber(match[10]),
    despesasEncargos: normalizeNumber(match[11]),
    impostoPagoNoEstrangeiro: normalizeNumber(match[12]),
    codPaisContraparte: match[13],
    valMobAdmNeg: /^S/i.test(match[14]) ? 'SIM' : 'NAO',
  }));
}

function extractRows92B(pageTexts: string[]): TaxRow92B[] {
  return extractRows(pageTexts, REGEX_92B, match => ({
    codigo: match[1],
    codPais: match[2],
    rendimentoLiquido: normalizeNumber(match[3]),
    impostoPagoNoEstrangeiro: normalizeNumber(match[4]),
    codPaisContraparte: match[5],
  }));
}

function extractRowsG13(pageTexts: string[]): TaxRowG13[] {
  return extractRows(pageTexts, REGEX_G13, match => ({
    codigoOperacao: match[1],
    titular: match[2],
    rendimentoLiquido: normalizeNumber(match[3]),
    paisContraparte: match[4],
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseXtbCapitalGainsPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  const looksLikeDividends = matchesAnyMarker(fullText, XTB_DIVIDENDS_MARKERS);
  const looksLikeGains = matchesAnyMarker(fullText, XTB_GAINS_MARKERS);

  if (looksLikeDividends && !looksLikeGains) {
    throw new BrokerParsingError(
      'The uploaded file appears to be an XTB Dividends PDF, but it was placed in the Capital Gains slot.',
      'parser.error.xtb_wrong_file_gains',
      { fileName: file.name }
    );
  }

  const rows92A = extractRows92A(pageTexts);
  const rows92B = extractRows92B(pageTexts);
  const rowsG13 = extractRowsG13(pageTexts);

  const totalRows = rows92A.length + rows92B.length + rowsG13.length;
  if (totalRows === 0) {
    throw new BrokerParsingError(
      `No capital gains rows found in "${file.name}". Please verify this is an XTB Capital Gains report.`,
      'parser.error.xtb_no_gains_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A: [],
    rows92A,
    rows92B,
    rowsG9: [],
    rowsG13,
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}

export async function parseXtbDividendsPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  const looksLikeGains = matchesAnyMarker(fullText, XTB_GAINS_MARKERS);
  const looksLikeDividends = matchesAnyMarker(fullText, XTB_DIVIDENDS_MARKERS);

  if (looksLikeGains && !looksLikeDividends) {
    throw new BrokerParsingError(
      'The uploaded file appears to be an XTB Capital Gains PDF, but it was placed in the Dividends slot.',
      'parser.error.xtb_wrong_file_dividends',
      { fileName: file.name }
    );
  }

  const rows8A = extractRows8A(pageTexts);

  if (rows8A.length === 0) {
    throw new BrokerParsingError(
      `No dividend rows found in "${file.name}". Please verify this is an XTB Dividends report.`,
      'parser.error.xtb_no_dividends_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A,
    rows92A: [],
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings: [],
  };
}

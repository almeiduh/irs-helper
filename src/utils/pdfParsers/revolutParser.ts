import type { TaxRow, TaxRow8A, ParsedPdfData } from '../../types';
import { resolveCountryCodeFromIsin } from '../brokerCountries';
import { BrokerParsingError } from '../parserErrors';
import { extractPdfText, matchesAnyMarker } from './common';

// ---------------------------------------------------------------------------
// Content fingerprints
// ---------------------------------------------------------------------------

const REVOLUT_MARKERS = [
  /Revolut\s+Securities\s+Europe\s+UAB/i,
  /Extrato\s+consolidado/i,
];

const REVOLUT_FUND_KEYWORDS = ['ETF', 'UCITS', 'FUND', 'SICAV'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyRevolutProduct(name: string): string {
  const upper = name.toUpperCase();
  if (REVOLUT_FUND_KEYWORDS.some(kw => upper.includes(kw))) return 'G20';
  return 'G01';
}

function parseRevolutEurAmount(s: string): number {
  const cleaned = s.replace(/[€\s]/g, '').replace(/,/g, '');
  return parseFloat(cleaned) || 0;
}

function parseRevolutDate(dateStr: string): { year: string; month: string; day: string } {
  const parts = dateStr.split('/');
  return {
    year: parts[2],
    month: String(parseInt(parts[1], 10)),
    day: String(parseInt(parts[0], 10)),
  };
}

function extractRevolutSection(
  text: string,
  startPattern: RegExp,
  endPatterns: RegExp[],
): string {
  const startMatch = startPattern.exec(text);
  if (!startMatch) return '';
  const afterStart = text.slice(startMatch.index + startMatch[0].length);
  let endIdx = afterStart.length;
  for (const endPat of endPatterns) {
    const endMatch = new RegExp(endPat.source, endPat.flags).exec(afterStart);
    if (endMatch && endMatch.index < endIdx) {
      endIdx = endMatch.index;
    }
  }
  return afterStart.slice(0, endIdx);
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const REVOLUT_ALL_SECTION_STARTS: RegExp[] = [
  /Vendas\s+EUR/i,
  /Outros\s+Rendimentos\s+EUR/i,
  /Vendas\s+USD/i,
  /Outros\s+Rendimentos\s+USD/i,
  /Operações\s+de\s+cript[oa]/i,
  /Operações\s+dos\s+Fundos\s+Monetários/i,
];

const REVOLUT_EUR_SALE_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+€\s*([\d,]+\.?\d*)\s+€\s*([\d,]+\.?\d*)\s+€\s*([\d,]+\.?\d*)/g;

const REVOLUT_EUR_DIV_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+€\s*([\d,]+\.?\d*)\s+€\s*([\d,]+\.?\d*)/g;

const REVOLUT_USD_SALE_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+/g;

const REVOLUT_USD_DIV_ROW =
  /([A-Z]{2}[A-Z0-9]{10})\s+([A-Z]{2})\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+\s+\$[\d,]+\.?\d*\s+€\s*([\d,]+\.?\d*)\s+Taxa:\s+[\d.]+/g;

// ---------------------------------------------------------------------------
// Row parsers
// ---------------------------------------------------------------------------

function parseRevolutSaleRows(sectionText: string, regex: RegExp): TaxRow[] {
  const rows: TaxRow[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(sectionText)) !== null) {
    const textBefore = sectionText.slice(lastEnd, match.index);
    const productNameMatch = textBefore.match(/([A-Za-zÀ-ÿ0-9&\-.' ]+)$/);
    const productName = productNameMatch ? productNameMatch[1].trim() : '';

    const isin = match[1];
    const country2 = match[2];
    const buyDate = parseRevolutDate(match[3]);
    const sellDate = parseRevolutDate(match[4]);
    const base = parseRevolutEurAmount(match[5]);
    const proceeds = parseRevolutEurAmount(match[6]);
    const commissions = parseRevolutEurAmount(match[7]);

    const countryCode3 = resolveCountryCodeFromIsin(country2) ?? '840';
    const typeCode = classifyRevolutProduct(productName + ' ' + isin);

    rows.push({
      codPais: countryCode3,
      codigo: typeCode,
      anoRealizacao: sellDate.year,
      mesRealizacao: sellDate.month,
      diaRealizacao: sellDate.day,
      valorRealizacao: proceeds.toFixed(2),
      anoAquisicao: buyDate.year,
      mesAquisicao: buyDate.month,
      diaAquisicao: buyDate.day,
      valorAquisicao: base.toFixed(2),
      despesasEncargos: commissions.toFixed(2),
      impostoPagoNoEstrangeiro: '0.00',
      codPaisContraparte: countryCode3,
    });

    lastEnd = match.index + match[0].length;
  }

  return rows;
}

function parseRevolutDivRows(sectionText: string, regex: RegExp): TaxRow8A[] {
  const rows: TaxRow8A[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(sectionText)) !== null) {
    const country2 = match[2];
    const gross = parseRevolutEurAmount(match[3]);
    const wht = parseRevolutEurAmount(match[4]);
    const countryCode3 = resolveCountryCodeFromIsin(country2) ?? '840';

    rows.push({
      codigo: 'E11',
      codPais: countryCode3,
      rendimentoBruto: gross.toFixed(2),
      impostoPago: wht.toFixed(2),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseRevolutConsolidatedPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  if (!matchesAnyMarker(fullText, REVOLUT_MARKERS)) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a Revolut Consolidated Statement. Please upload the correct file.`,
      'parser.error.revolut_wrong_file',
      { fileName: file.name },
    );
  }

  const rows8A: TaxRow8A[] = [];
  const rows92A: TaxRow[] = [];
  const warnings: string[] = [];

  // --- MMF Interest (page 1 summary) ---
  const mmfMatch = fullText.match(/Juros\s+totais\s+auferidos\s+€\s*([\d,]+\.?\d*)/i);
  if (mmfMatch) {
    const gross = parseRevolutEurAmount(mmfMatch[1]);
    if (gross > 0) {
      rows8A.push({
        codigo: 'E21',
        codPais: '372',
        rendimentoBruto: gross.toFixed(2),
        impostoPago: '0.00',
      });
    }
  }

  // --- EUR Sales ---
  const eurSalesSection = extractRevolutSection(
    fullText,
    /Vendas\s+EUR/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows92A.push(...parseRevolutSaleRows(eurSalesSection, REVOLUT_EUR_SALE_ROW));

  // --- EUR Dividends ---
  const eurDivSection = extractRevolutSection(
    fullText,
    /Outros\s+Rendimentos\s+EUR/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows8A.push(...parseRevolutDivRows(eurDivSection, REVOLUT_EUR_DIV_ROW));

  // --- USD Sales ---
  const usdSalesSection = extractRevolutSection(
    fullText,
    /Vendas\s+USD/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows92A.push(...parseRevolutSaleRows(usdSalesSection, REVOLUT_USD_SALE_ROW));

  // --- USD Dividends ---
  const usdDivSection = extractRevolutSection(
    fullText,
    /Outros\s+Rendimentos\s+USD/i,
    REVOLUT_ALL_SECTION_STARTS,
  );
  rows8A.push(...parseRevolutDivRows(usdDivSection, REVOLUT_USD_DIV_ROW));

  // --- Crypto: USD-only amounts — skip and warn ---
  if (/Operações\s+de\s+cript[oa]/i.test(fullText)) {
    warnings.push('parser.warning.revolut_crypto_usd_only');
  }

  return {
    rows8A,
    rows92A,
    rows92B: [],
    rowsG9: [],
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings,
  };
}

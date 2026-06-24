import type { TaxRow, ParsedPdfData } from '../../types';
import { BrokerParsingError } from '../parserErrors';
import { normalizeNumber, extractPdfText, matchesAnyMarker } from './common';

const OPENBANK_MARKERS = [
  /Open Bank S\.A\./i,
  /openbank\.pt/i,
  /INCREMENTOS PATRIMONIAIS DE OPÇÃO DE ENGLOBAMENTO/i,
];

const REGEX_92A = /(?:^|\s)\d{3,}\s+(\d{3})\s+(G\d{2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s+\S+/g;

function extractRows92A(pageTexts: string[]): TaxRow[] {
  const rows: TaxRow[] = [];

  for (const text of pageTexts) {
    const regex = new RegExp(REGEX_92A.source, REGEX_92A.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const codPais = match[1];

      rows.push({
        codPais,
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
        codPaisContraparte: codPais,
      });
    }
  }

  return rows;
}

export async function parseOpenBankPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  const looksLikeOpenBank = matchesAnyMarker(fullText, OPENBANK_MARKERS);

  if (!looksLikeOpenBank) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be an OpenBank tax report. Please upload the correct file.`,
      'parser.error.openbank_wrong_file',
      { fileName: file.name },
    );
  }

  const rows92A = extractRows92A(pageTexts);

  if (rows92A.length === 0) {
    throw new BrokerParsingError(
      `No capital gains rows found in "${file.name}". Please verify this is an OpenBank capital gains report.`,
      'parser.error.openbank_no_rows',
      { fileName: file.name },
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

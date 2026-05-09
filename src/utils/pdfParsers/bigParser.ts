import type { TaxRow, TaxRowG9, ParsedPdfData } from '../../types';
import { BrokerParsingError } from '../parserErrors';
import { extractPdfText, matchesAnyMarker } from './common';
import { resolveCountryCodeFromIsin } from '../brokerCountries';

// ---------------------------------------------------------------------------
// Content fingerprints
// ---------------------------------------------------------------------------

const BIG_MARKERS = [
  /Valias para Efeitos Fiscais/i,
  /Pa[ií]s emitente/,
];

// ---------------------------------------------------------------------------
// Country name → ISO 3166-1 numeric (BIG PDFs use uppercase Portuguese names)
// ---------------------------------------------------------------------------

const BIG_COUNTRY_CODES: Record<string, string> = {
  'PORTUGAL': '620',
  'IRLANDA': '372',
  'EUA': '840',
  'REINO UNIDO': '826',
  'ALEMANHA': '276',
  'FRANÇA': '250',
  'ESPANHA': '724',
  'HOLANDA': '528',
  'PAÍSES BAIXOS': '528',
  'LUXEMBURGO': '442',
  'ITÁLIA': '380',
  'SUÍÇA': '756',
  'JAPÃO': '392',
  'CANADÁ': '124',
  'AUSTRÁLIA': '036',
  'CHINA': '156',
  'HONG KONG': '344',
  'SINGAPURA': '702',
  'NORUEGA': '578',
  'SUÉCIA': '752',
  'DINAMARCA': '208',
  'FINLÂNDIA': '246',
  'BÉLGICA': '056',
  'ÁUSTRIA': '040',
  'JERSEY': '832',
  'ILHAS CAIMÃO': '136',
  'COREIA DO SUL': '410',
  'BRASIL': '076',
  'ÍNDIA': '356',
};

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Security header: "Name - ISIN - CURRENCY" — anchor on ISIN (12-char alphanumeric, 2 alpha + 10 alphanum)
const SECURITY_RE = / - ([A-Z]{2}[A-Z0-9]{10}) - [A-Z]{3}/g;

// Foreign country: "País emitente - COUNTRY" with known country names (longest first for correct alternation)
const BIG_COUNTRY_NAMES = [
  'PAÍSES BAIXOS', 'COREIA DO SUL', 'ILHAS CAIMÃO', 'REINO UNIDO',
  'LUXEMBURGO', 'HONG KONG', 'DINAMARCA', 'FINLÂNDIA', 'SINGAPURA',
  'AUSTRÁLIA', 'PORTUGAL', 'ALEMANHA', 'BÉLGICA', 'HOLANDA', 'NORUEGA',
  'IRLANDA', 'ESPANHA', 'ÁUSTRIA', 'BRASIL', 'CANADÁ', 'ITÁLIA',
  'SUÉCIA', 'JERSEY', 'CHINA', 'JAPÃO', 'SUÍÇA', 'ÍNDIA', 'FRANÇA', 'EUA',
];
const FOREIGN_COUNTRY_RE = new RegExp(
  `Pa[ií]s emitente\\s*-\\s+(${BIG_COUNTRY_NAMES.join('|')})`,
  'g',
);

// Portuguese emitter: "Emitente NIF - PORTUGAL"
const PT_EMITTER_RE = /\bEmitente\s+(\d{9})\s+-\s+PORTUGAL\b/g;

// Transaction row: date price value date price value quantity charges gain (9 fields)
const TX_RE = /(\d{4}-\d{2}-\d{2})\s+([\d.,]+%?)\s+([\d.,]+)\s+(\d{4}-\d{2}-\d{2})\s+([\d.,]+%?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(-?[\d.,]+)/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePtNumber(s: string): string {
  return s.replace(/%/g, '').trim().replace(/\./g, '').replace(/,/g, '.');
}

function parseDate(dateStr: string): { year: string; month: string; day: string } {
  const [year, month, day] = dateStr.split('-');
  return { year, month: String(parseInt(month, 10)), day: String(parseInt(day, 10)) };
}

function determineGainCode(openPrice: string, closePrice: string): string {
  const isBond = openPrice.includes('%') || closePrice.includes('%');
  if (!isBond) return 'G01';
  const closeVal = parseFloat(parsePtNumber(closePrice));
  return Math.abs(closeVal - 100.0) < 0.01 ? 'G10' : 'G03';
}

function resolveCountryCode(isin: string, countryName: string | null): string | undefined {
  const fromIsin = resolveCountryCodeFromIsin(isin);
  if (fromIsin) return fromIsin;
  if (countryName) return BIG_COUNTRY_CODES[countryName.trim().toUpperCase()];
  return undefined;
}

// ---------------------------------------------------------------------------
// Event-based stateful parsing
// ---------------------------------------------------------------------------

type ParseEvent =
  | { type: 'security'; index: number; isin: string }
  | { type: 'foreign-country'; index: number; country: string }
  | { type: 'pt-emitter'; index: number; emitterNif: string }
  | { type: 'transaction'; index: number; openDate: string; openPrice: string; openValue: string; closeDate: string; closePrice: string; closeValue: string; charges: string };

function collectEvents(text: string): ParseEvent[] {
  const events: ParseEvent[] = [];
  let m: RegExpExecArray | null;

  const secRe = new RegExp(SECURITY_RE.source, SECURITY_RE.flags);
  while ((m = secRe.exec(text)) !== null) {
    events.push({ type: 'security', index: m.index, isin: m[1] });
  }

  const fcRe = new RegExp(FOREIGN_COUNTRY_RE.source, FOREIGN_COUNTRY_RE.flags);
  while ((m = fcRe.exec(text)) !== null) {
    events.push({ type: 'foreign-country', index: m.index, country: m[1].trim() });
  }

  const ptRe = new RegExp(PT_EMITTER_RE.source, PT_EMITTER_RE.flags);
  while ((m = ptRe.exec(text)) !== null) {
    events.push({ type: 'pt-emitter', index: m.index, emitterNif: m[1] });
  }

  const txRe = new RegExp(TX_RE.source, TX_RE.flags);
  while ((m = txRe.exec(text)) !== null) {
    events.push({
      type: 'transaction',
      index: m.index,
      openDate: m[1],
      openPrice: m[2],
      openValue: m[3],
      closeDate: m[4],
      closePrice: m[5],
      closeValue: m[6],
      charges: m[8],
    });
  }

  return events.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseBigCapitalGainsPdf(file: File): Promise<ParsedPdfData> {
  const pageTexts = await extractPdfText(file);
  const fullText = pageTexts.join(' ');

  if (!matchesAnyMarker(fullText, BIG_MARKERS)) {
    throw new BrokerParsingError(
      `"${file.name}" does not appear to be a BiG bank capital gains statement (VALIAS PDF). Please upload the correct file.`,
      'parser.error.big_wrong_file',
      { fileName: file.name }
    );
  }

  const rows92A: TaxRow[] = [];
  const rowsG9: TaxRowG9[] = [];
  const warnings: string[] = [];

  let currentIsin: string | null = null;
  let currentCountry: string | null = null;
  let currentEmitterNif: string | null = null;
  let isPortuguese = false;

  for (const event of collectEvents(fullText)) {
    if (event.type === 'security') {
      currentIsin = event.isin;
      currentCountry = null;
      currentEmitterNif = null;
      isPortuguese = false;
    } else if (event.type === 'foreign-country') {
      currentCountry = event.country;
      isPortuguese = false;
    } else if (event.type === 'pt-emitter') {
      currentCountry = 'PORTUGAL';
      currentEmitterNif = event.emitterNif;
      isPortuguese = true;
    } else if (event.type === 'transaction') {
      if (!currentIsin) continue;

      const gainCode = determineGainCode(event.openPrice, event.closePrice);
      const openDate = parseDate(event.openDate);
      const closeDate = parseDate(event.closeDate);
      const openValue = parsePtNumber(event.openValue);
      const closeValue = parsePtNumber(event.closeValue);
      const charges = parsePtNumber(event.charges);

      if (isPortuguese) {
        if (!currentEmitterNif) {
          warnings.push('parser.warning.big_pt_no_nif');
          continue;
        }
        rowsG9.push({
          titular: 'A',
          nif: currentEmitterNif,
          codEncargos: gainCode,
          anoRealizacao: closeDate.year,
          mesRealizacao: closeDate.month,
          diaRealizacao: closeDate.day,
          valorRealizacao: closeValue,
          anoAquisicao: openDate.year,
          mesAquisicao: openDate.month,
          diaAquisicao: openDate.day,
          valorAquisicao: openValue,
          despesasEncargos: charges,
          paisContraparte: '620',
        });
      } else {
        const countryCode = resolveCountryCode(currentIsin, currentCountry);
        if (!countryCode) {
          warnings.push('parser.warning.big_unknown_country');
          continue;
        }
        rows92A.push({
          codPais: countryCode,
          codigo: gainCode,
          anoRealizacao: closeDate.year,
          mesRealizacao: closeDate.month,
          diaRealizacao: closeDate.day,
          valorRealizacao: closeValue,
          anoAquisicao: openDate.year,
          mesAquisicao: openDate.month,
          diaAquisicao: openDate.day,
          valorAquisicao: openValue,
          despesasEncargos: charges,
          impostoPagoNoEstrangeiro: '0',
          codPaisContraparte: '620',
        });
      }
    }
  }

  if (rows92A.length === 0 && rowsG9.length === 0) {
    throw new BrokerParsingError(
      `No capital gains rows found in "${file.name}". Please verify this is a BiG bank capital gains statement (VALIAS PDF).`,
      'parser.error.big_no_rows',
      { fileName: file.name }
    );
  }

  return {
    rows8A: [],
    rows92A,
    rows92B: [],
    rowsG9,
    rowsG13: [],
    rowsG18A: [],
    rowsG1q7: [],
    warnings,
  };
}
